import { Client } from '@elastic/elasticsearch';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  node: process.env.ELASTIC_URL,
  auth: {
    username: process.env.ELASTIC_USERNAME,
    password: process.env.ELASTIC_PASSWORD,
  },
});

const INDEX = 'podcast';
const CHUNKS_INDEX = 'podcast_chunks';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const search = async (keyword) => {
  const result = await client.search({
    index: INDEX,
    body: {
      query: {
        match: { content: keyword },
      },
      highlight: {
        fields: {
          content: { number_of_fragments: 2, fragment_size: 120, pre_tags: ['<em>'], post_tags: ['</em>'] },
          note: { number_of_fragments: 1, fragment_size: 120, pre_tags: ['<em>'], post_tags: ['</em>'] },
        },
      },
      _source: { excludes: ['content', 'segments'] },
    },
  });
  return result.hits.hits.map((hit) => {
    const contentFragments = hit.highlight?.content ?? [];
    const noteFragments = hit.highlight?.note ?? [];
    const combined = [...contentFragments, ...noteFragments];
    const deduped = [...new Set(combined)].slice(0, 3);
    return {
      podcaster: hit._source.podcaster,
      title: hit._source.title,
      uploadDate: hit._source.uploadDate,
      episode: hit._source.episode,
      fullTitle: hit._source.fullTitle,
      highlight: deduped,
    };
  });
};

export const getPodcastByPodcasterAndEpisode = async (podcaster, episode) => {
  const result = await client.search({
    index: INDEX,
    body: {
      query: {
        bool: {
          must: [
            { term: { podcaster: podcaster } },
            { term: { episode: episode } },
          ],
        },
      },
      _source: { excludes: ['content', 'segments'] },
      size: 1,
    },
  });

  const hit = result.hits.hits[0];
  if (!hit) return null;

  const document = hit._source;
  if (document.note) {
    document.noteSections = document.note
      .split('- ')
      .filter((section) => section.trim() !== '');
  }
  return document;
};

const CHUNKS_PAGE_SIZE = 10;

export const getPodcastTranscript = async (podcaster, episode) => {
  const result = await client.search({
    index: INDEX,
    body: {
      query: {
        bool: {
          must: [
            { term: { podcaster: podcaster } },
            { term: { episode: episode } },
          ],
        },
      },
      _source: ['content', 'segments'],
      size: 1,
    },
  });
  const hit = result.hits.hits[0];
  if (!hit || hit._source.content == null) return null;
  return { content: hit._source.content, segments: hit._source.segments ?? null };
};

export const getPodcastChunks = async (podcaster, episode, page = 1) => {
  const result = await client.search({
    index: CHUNKS_INDEX,
    body: {
      query: {
        bool: {
          must: [
            { term: { podcaster: podcaster } },
            { term: { episode: episode } },
          ],
        },
      },
      sort: [{ chunk_index: { order: 'asc' } }],
      _source: ['chunk_index', 'content'],
      from: (page - 1) * CHUNKS_PAGE_SIZE,
      size: CHUNKS_PAGE_SIZE,
    },
  });

  const total = result.hits.total.value;
  const chunks = result.hits.hits.map((hit) => ({
    chunk_index: hit._source.chunk_index,
    chunk_text: hit._source.content,
  }));

  return {
    chunks,
    total,
    page,
    hasMore: page * CHUNKS_PAGE_SIZE < total,
  };
};

export const askWithContext = async (question, onSources, onChunk, onDone) => {
  // Embed the question
  const embeddingRes = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: question,
  });
  const embedding = embeddingRes.data[0].embedding;

  // kNN search for relevant chunks
  const knnResult = await client.search({
    index: CHUNKS_INDEX,
    body: {
      knn: {
        field: 'embedding',
        query_vector: embedding,
        k: 5,
        num_candidates: 50,
      },
      _source: ['content', 'fullTitle', 'episode', 'podcaster', 'title'],
    },
  });

  const hits = knnResult.hits.hits;

  // Deduplicate sources by episode
  const seen = new Set();
  const sources = [];
  for (const h of hits) {
    const key = `${h._source.podcaster}:${h._source.episode}`;
    if (!seen.has(key)) {
      seen.add(key);
      sources.push({
        podcaster: h._source.podcaster,
        episode: h._source.episode,
        title: h._source.title,
        fullTitle: h._source.fullTitle,
      });
    }
  }
  onSources(sources);

  const context = hits
    .map((h) => `[${h._source.fullTitle}]\n${h._source.content}`)
    .join('\n\n---\n\n');

  // Stream GPT-4o-mini response
  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    stream: true,
    messages: [
      {
        role: 'system',
        content:
          '你是一個專業的 podcast 問答助手，根據以下 podcast 內容片段回答問題，用繁體中文回答，並引用來源集數。',
      },
      {
        role: 'user',
        content: `以下是相關的 podcast 內容：\n\n${context}\n\n問題：${question}`,
      },
    ],
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) onChunk(content);
  }
  onDone();
};

const PERSONA_SYSTEM_PROMPT = `你是股癌，台灣知名的財經 Podcast 主持人。你正在和聽眾進行對話。

【身份與風格】
- 以第一人稱回答，就像你本人在說話，不要說「根據股癌說的」或「股癌認為」
- 說話直接、有觀點，不講廢話；喜歡用比喻和具體例子讓抽象概念變得易懂
- 偶爾會自嘲，帶點幽默，但不失專業深度
- 用台式中文（繁體），偶爾夾雜英文財經術語（例如：Fed、yield curve、positioning、narrative）
- 對市場、地緣政治、生活方式都有強烈的個人見解，敢直說
- 講話有節奏感，會用「你知道嗎」、「說真的」、「重點是」這類口頭語來轉換話題

【知識來源】
- 你的回答要以提供的 podcast 內容片段為主要依據
- 如果片段裡沒有相關資訊，用你的風格誠實說「這個我沒特別講過，但我的看法是...」
- 不要捏造具體數字、日期或事件

【對話連續性】
- 記得我們之前的對話內容，保持上下文一致
- 如果用戶在追問或深入某個話題，給更深入的回答，不要重複已說過的內容

回答長度：簡潔為主，通常 150-300 字；如果話題複雜可以稍長，但不要灌水。`;

export const chatWithContext = async (question, messages, onSources, onChunk, onDone) => {
  // Embed the question
  const embeddingRes = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: question,
  });
  const embedding = embeddingRes.data[0].embedding;

  // kNN search for relevant chunks
  const knnResult = await client.search({
    index: CHUNKS_INDEX,
    body: {
      knn: {
        field: 'embedding',
        query_vector: embedding,
        k: 5,
        num_candidates: 50,
      },
      _source: ['content', 'fullTitle', 'episode', 'podcaster', 'title'],
    },
  });

  const hits = knnResult.hits.hits;

  // Deduplicate sources by episode
  const seen = new Set();
  const sources = [];
  for (const h of hits) {
    const key = `${h._source.podcaster}:${h._source.episode}`;
    if (!seen.has(key)) {
      seen.add(key);
      sources.push({
        podcaster: h._source.podcaster,
        episode: h._source.episode,
        title: h._source.title,
        fullTitle: h._source.fullTitle,
      });
    }
  }
  onSources(sources);

  const context = hits
    .map((h) => `[${h._source.fullTitle}]\n${h._source.content}`)
    .join('\n\n---\n\n');

  // Include last 6 messages of history (3 turns) as safety cap
  const history = (messages || []).slice(-6);

  // Stream GPT-4o-mini response as the host persona
  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    stream: true,
    messages: [
      { role: 'system', content: PERSONA_SYSTEM_PROMPT },
      ...history,
      {
        role: 'user',
        content: `以下是相關的 podcast 內容片段，請根據這些內容和我們的對話回答：\n\n${context}\n\n用戶問題：${question}`,
      },
    ],
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) onChunk(content);
  }
  onDone();
};

export const getThemesTimeline = async () => {
  const result = await client.search({
    index: INDEX,
    body: {
      size: 200,
      sort: [{ uploadDate: { order: 'asc' } }],
      _source: ['episode', 'fullTitle', 'title', 'uploadDate', 'themes'],
      query: { exists: { field: 'themes' } },
    },
  });

  const episodes = result.hits.hits.map((h) => h._source);

  // Build timeline map: { "2024-06": { "美股與科技股": 2 } }
  // uploadDate is stored as "20240612" → convert to "2024-06"
  const timeline = {};
  for (const ep of episodes) {
    if (!ep.themes || !ep.uploadDate) continue;
    const d = ep.uploadDate;
    const month = `${d.slice(0, 4)}-${d.slice(4, 6)}`;
    if (!timeline[month]) timeline[month] = {};
    for (const theme of ep.themes) {
      timeline[month][theme] = (timeline[month][theme] || 0) + 1;
    }
  }

  return { timeline, episodes };
};

export const getStocksList = async () => {
  // Aggregate mention counts per ticker
  const aggResult = await client.search({
    index: INDEX,
    body: {
      size: 0,
      aggs: {
        tickers: {
          terms: { field: 'mentioned_stocks.keyword', size: 500 },
        },
      },
    },
  });

  // Build a count map from aggregation buckets
  const countMap = {};
  for (const b of aggResult.aggregations.tickers.buckets) {
    countMap[b.key] = b.doc_count;
  }

  // Fetch all episodes that have mentioned_stocks to compute firstDate/lastDate in JS
  const episodesResult = await client.search({
    index: INDEX,
    body: {
      size: 1000,
      _source: ['uploadDate', 'mentioned_stocks'],
      query: { exists: { field: 'mentioned_stocks' } },
    },
  });

  // Compute firstDate and lastDate per ticker by iterating hits
  const firstDate = {};
  const lastDate = {};
  for (const hit of episodesResult.hits.hits) {
    const { uploadDate, mentioned_stocks } = hit._source;
    if (!uploadDate || !mentioned_stocks) continue;
    for (const ticker of mentioned_stocks) {
      if (firstDate[ticker] === undefined || uploadDate < firstDate[ticker]) {
        firstDate[ticker] = uploadDate;
      }
      if (lastDate[ticker] === undefined || uploadDate > lastDate[ticker]) {
        lastDate[ticker] = uploadDate;
      }
    }
  }

  return aggResult.aggregations.tickers.buckets.map((b) => ({
    ticker: b.key,
    count: b.doc_count,
    firstDate: firstDate[b.key] ?? null,
    lastDate: lastDate[b.key] ?? null,
  }));
};

export const getStockDetail = async (ticker) => {
  const upperTicker = ticker.toUpperCase();
  const result = await client.search({
    index: INDEX,
    body: {
      size: 200,
      sort: [{ uploadDate: { order: 'desc' } }],
      _source: ['episode', 'fullTitle', 'title', 'uploadDate', 'stock_sentiments'],
      query: { term: { 'mentioned_stocks.keyword': upperTicker } },
    },
  });

  const episodes = result.hits.hits.map((h) => {
    const src = h._source;
    const match = (src.stock_sentiments || []).find(
      (s) => s.ticker === upperTicker
    );
    return {
      episode: src.episode,
      fullTitle: src.fullTitle,
      title: src.title,
      uploadDate: src.uploadDate,
      sentiment: match?.sentiment ?? 'neutral',
    };
  });

  // Tally sentiment counts
  const sentimentCounts = { bullish: 0, bearish: 0, neutral: 0 };
  for (const ep of episodes) sentimentCounts[ep.sentiment]++;

  return { ticker: upperTicker, episodes, sentimentCounts };
};

export const getSentimentTimeline = async () => {
  const result = await client.search({
    index: INDEX,
    body: {
      size: 200,
      sort: [{ uploadDate: { order: 'asc' } }],
      _source: ['episode', 'fullTitle', 'title', 'uploadDate', 'market_sentiment'],
      query: { exists: { field: 'market_sentiment' } },
    },
  });

  return result.hits.hits.map((h) => {
    const src = h._source;
    return {
      episode: src.episode,
      fullTitle: src.fullTitle,
      title: src.title,
      uploadDate: src.uploadDate,
      score: src.market_sentiment?.score ?? 0,
      label: src.market_sentiment?.label ?? '謹慎',
      reason: src.market_sentiment?.reason ?? '',
    };
  });
};

export const getStockDrift = async (ticker) => {
  const upperTicker = ticker.toUpperCase();
  const result = await client.search({
    index: INDEX,
    body: {
      size: 200,
      sort: [{ uploadDate: { order: 'asc' } }],
      _source: ['episode', 'fullTitle', 'title', 'uploadDate', 'stock_sentiments', 'investment_thesis'],
      query: { term: { 'mentioned_stocks.keyword': upperTicker } },
    },
  });

  const timeline = result.hits.hits.map((h) => {
    const src = h._source;
    const sentimentMatch = (src.stock_sentiments || []).find(
      (s) => s.ticker === upperTicker
    );
    const sentiment = sentimentMatch?.sentiment ?? 'neutral';

    const thesis = src.investment_thesis ?? {};
    const bullishEntries = thesis.bullish ?? [];
    const bearishEntries = thesis.bearish ?? [];

    const bullishMatch = bullishEntries.find(
      (e) => e.stock && e.stock.toUpperCase() === upperTicker
    );
    const bearishMatch = bearishEntries.find(
      (e) => e.stock && e.stock.toUpperCase() === upperTicker
    );

    const reason = bullishMatch?.reason ?? bearishMatch?.reason ?? '';

    return {
      episode: src.episode,
      title: src.title,
      uploadDate: src.uploadDate,
      sentiment,
      reason,
    };
  });

  const episodesWithReasons = timeline.filter((e) => e.reason !== '');

  let driftAnalysis = '';
  if (episodesWithReasons.length >= 2) {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: '你是財經分析師，分析主持人對特定股票的觀點如何隨時間演變。',
        },
        {
          role: 'user',
          content: `以下是主持人在不同集數中對 ${upperTicker} 的看法時間線（JSON 格式）：\n\n${JSON.stringify(episodesWithReasons, null, 2)}\n\n請用繁體中文撰寫一段簡短分析（150-250字），指出觀點的轉折點：何時情緒改變、可能的原因。若沒有明顯轉變，請簡短說明。`,
        },
      ],
    });
    driftAnalysis = completion.choices[0]?.message?.content ?? '';
  }

  return { timeline, driftAnalysis };
};

export const askAboutStock = async (ticker, onSources, onChunk, onDone) => {
  const upperTicker = ticker.toUpperCase().trim();

  // Step 1: find episodes that mention this ticker
  const episodeResult = await client.search({
    index: INDEX,
    body: {
      size: 200,
      _source: ['episode', 'title', 'fullTitle', 'podcaster', 'uploadDate'],
      query: { term: { 'mentioned_stocks.keyword': upperTicker } },
      sort: [{ uploadDate: { order: 'asc' } }],
    },
  });

  const episodeHits = episodeResult.hits.hits;

  if (episodeHits.length === 0) {
    onSources([]);
    onChunk(`找不到 ${upperTicker} 的相關討論紀錄。`);
    onDone();
    return;
  }

  const episodeNumbers = episodeHits.map((h) => h._source.episode);

  // Build source list from episode hits (already sorted by date asc)
  const sources = episodeHits.map((h) => ({
    podcaster: h._source.podcaster,
    episode: h._source.episode,
    title: h._source.title,
    fullTitle: h._source.fullTitle,
  }));
  onSources(sources);

  // Step 2: embed the ticker as query to find most relevant chunks
  const embeddingRes = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: `${upperTicker} 股票投資觀點`,
  });
  const embedding = embeddingRes.data[0].embedding;

  // Step 3: kNN on podcast_chunks filtered to those episodes
  const knnResult = await client.search({
    index: CHUNKS_INDEX,
    body: {
      knn: {
        field: 'embedding',
        query_vector: embedding,
        k: 10,
        num_candidates: 100,
        filter: { terms: { episode: episodeNumbers } },
      },
      _source: ['content', 'fullTitle', 'episode', 'title'],
    },
  });

  const context = knnResult.hits.hits
    .map((h) => `[${h._source.fullTitle}]\n${h._source.content}`)
    .join('\n\n---\n\n');

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    stream: true,
    messages: [
      {
        role: 'system',
        content:
          '你是一個專業的財經 podcast 分析助手。根據提供的 podcast 內容片段，整理主持人對特定股票的觀點，以時間軸格式呈現（最早到最近），每筆標示集數，並說明當時看多/看空/中性的原因。用繁體中文回答。',
      },
      {
        role: 'user',
        content: `以下是主持人提到 ${upperTicker} 的 podcast 內容片段：\n\n${context}\n\n請整理主持人歷年對 ${upperTicker} 的看法，按時間順序（最早→最近），每筆標示集數和觀點方向及原因。`,
      },
    ],
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) onChunk(content);
  }
  onDone();
};

export const getGlossary = async () => {
  const result = await client.search({
    index: INDEX,
    body: {
      size: 200,
      _source: ['episode', 'fullTitle', 'title', 'uploadDate', 'glossary_terms'],
      query: { exists: { field: 'glossary_terms' } },
    },
  });

  // Aggregate by term
  const termMap = {};
  for (const hit of result.hits.hits) {
    const src = hit._source;
    if (!src.glossary_terms || !Array.isArray(src.glossary_terms)) continue;
    for (const entry of src.glossary_terms) {
      if (!entry.term) continue;
      if (!termMap[entry.term]) {
        termMap[entry.term] = { term: entry.term, count: 0, occurrences: [] };
      }
      termMap[entry.term].count += 1;
      termMap[entry.term].occurrences.push({
        episode: src.episode,
        fullTitle: src.fullTitle,
        title: src.title,
        uploadDate: src.uploadDate,
        quote: entry.quote || '',
      });
    }
  }

  // Sort occurrences by uploadDate asc, then sort terms by count desc
  return Object.values(termMap)
    .map((t) => ({
      ...t,
      occurrences: t.occurrences.sort((a, b) =>
        (a.uploadDate || '').localeCompare(b.uploadDate || '')
      ),
    }))
    .sort((a, b) => b.count - a.count);
};

export const getPodcasts = async (page = 1, limit = 10) => {
  const result = await client.search({
    index: INDEX,
    body: {
      query: { match_all: {} },
      sort: [{ uploadDate: { order: 'desc' } }],
      _source: ['title', 'uploadDate', 'episode', 'fullTitle', 'podcaster', 'note'],
      from: (page - 1) * limit,
      size: limit,
    },
  });

  return result.hits.hits.map((hit) => hit._source);
};
