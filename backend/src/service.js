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
        fields: { content: {} },
        pre_tags: ['{{HIGHLIGHT}}'],
        post_tags: ['{{/HIGHLIGHT}}'],
      },
      _source: { excludes: ['content'] },
    },
  });
  return result.hits.hits.map((hit) => ({
    podcaster: hit._source.podcaster,
    title: hit._source.title,
    uploadDate: hit._source.uploadDate,
    episode: hit._source.episode,
    fullTitle: hit._source.fullTitle,
    highlights: hit.highlight.content,
  }));
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
      _source: { excludes: ['content'] },
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

export const getPodcastTranscriptByPodcasterAndEpisode = async (podcaster, episode) => {
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
      _source: ['content'],
      size: 1,
    },
  });

  const hit = result.hits.hits[0];
  if (!hit) return null;
  return { content: hit._source.content };
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

export const getPodcasts = async (page = 1, limit = 10) => {
  const result = await client.search({
    index: INDEX,
    body: {
      query: { match_all: {} },
      sort: [{ uploadDate: { order: 'desc' } }],
      _source: ['title', 'uploadDate', 'episode', 'fullTitle', 'podcaster'],
      from: (page - 1) * limit,
      size: limit,
    },
  });

  return result.hits.hits.map((hit) => hit._source);
};
