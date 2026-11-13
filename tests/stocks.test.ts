import { describe, expect, it, vi } from 'vitest';
import { type DB, openDb } from '@/lib/db.ts';
import { stockDescription, stockName, stockTitle } from '@/lib/seo.ts';
import {
  buildStockIndex,
  canonicalCode,
  chartBars,
  coMentioned,
  type EpisodeOutline,
  findStock,
  listedStocks,
  searchKey,
  type StockRow,
  stockFor,
  stockHref,
  stockMatches,
  stockMonths,
  stockQuestion,
  stockSearchText,
} from '@/lib/stocks.ts';

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/server-db.ts', () => ({ readDb: async () => mocks.db }));
const { episodeOutlines, excerptAt, excerptFrom, liveMonths, stockIndex, stockPlayPoints, stockRows } = await import('@/lib/stock-pages.ts');

const row = (episodeNo: number, name: string, code: string | null, detail = `${name} 的事`, startSec = 60): StockRow => ({
  name,
  code,
  detail,
  startSec,
  episodeNo,
  title: '⭐',
  audioUrl: `https://audio.example/${episodeNo}.mp3`,
  publishedAt: `2026-01-${String(episodeNo % 28 || 28).padStart(2, '0')}T12:00:00Z`,
});

describe('canonicalCode', () => {
  // Every spelling below is one the summaries really have
  it('gives one code for the ways a Taiwan stock gets written', () => {
    for (const raw of ['2330', '2330/TSM', '2330.TW/TSM', 'TSM', 'tsm', '２３３０']) expect(canonicalCode(raw)).toBe('2330');
    expect(canonicalCode('2454.TW')).toBe('2454');
    expect(canonicalCode('5347.TWO')).toBe('5347');
    expect(canonicalCode('00631L')).toBe('00631L');
  });

  it('merges share classes and ADRs, and gives bare foreign codes their exchange', () => {
    expect(canonicalCode('GOOG')).toBe('GOOGL');
    expect(canonicalCode('NTDOY')).toBe('7974.T');
    expect(canonicalCode('7974')).toBe('7974.T');
    expect(canonicalCode('IFNNY')).toBe('IFX.DE');
  });

  it('keeps other exchanges and share classes as written', () => {
    for (const raw of ['005930.KS', 'BRK.B', '285A.T', 'ANT']) expect(canonicalCode(raw)).toBe(raw);
  });

  it('has nothing for an empty or unusable code', () => {
    for (const raw of [null, undefined, '', '  ', '台積電', '（未上市）']) expect(canonicalCode(raw)).toBeNull();
  });
});

describe('buildStockIndex', () => {
  it('merges the spellings of one company into one page, newest episode first', () => {
    const index = buildStockIndex([
      row(713, 'TSMC／台積電', '2330/TSM'),
      row(712, '台積電', 'TSM'),
      row(710, '台積電', '2330'),
    ]);
    expect(index.byKey.size).toBe(1);
    const stock = findStock(index, '2330')!;
    // The name most rows use
    expect(stock).toMatchObject({ slug: '2330', name: '台積電', code: '2330', market: 'tw' });
    expect(stock.episodes.map((e) => e.no)).toEqual([713, 712, 710]);
  });

  it('gives a row without a code the code its name has in other episodes', () => {
    const index = buildStockIndex([
      row(713, 'Anthropic', null),
      row(712, 'Anthropic', null),
      row(709, 'Anthropic', 'ANT'),
      row(708, '三星', null),
      row(707, '三星', '005930.KS'),
    ]);
    expect(findStock(index, 'ANT')!.episodes.map((e) => e.no)).toEqual([713, 712, 709]);
    expect(stockFor(index, 'Anthropic', null)!.slug).toBe('ANT');
    expect(findStock(index, '005930.KS')!.episodes).toHaveLength(2);
    // A row named by its own ticker joins it too
    expect(stockFor(buildStockIndex([row(1, '輝達', 'NVDA'), row(2, 'NVDA', null)]), 'NVDA', null)!.episodes).toHaveLength(2);
  });

  it('pages a company without any code by its name, whatever the case or width', () => {
    const index = buildStockIndex([row(713, 'OpenAI', null), row(712, 'OpenAI', null), row(711, 'ＯpenAI', null), row(710, 'openai', null)]);
    const stock = findStock(index, 'OpenAI')!;
    // The URL is the lower-case name, whichever spelling the newest episode uses
    expect(stock).toMatchObject({ slug: 'openai', name: 'OpenAI', code: null, market: 'none' });
    expect(stock.episodes).toHaveLength(4);
    expect(stockHref(stock)).toBe('/stock/openai');
  });

  it('gives no page to an industry, an index or an unnamed ETF without a code', () => {
    const names = ['被動元件產業', '台股大盤', '指數型ETF', '低軌衛星族群', '核能類股', '東證指數', '美國國債', '台指期', 'ByteDance／Seedance'];
    const index = buildStockIndex(names.map((n, i) => row(700 + i, n, null)));
    expect(index.byKey.size).toBe(0);
    for (const n of names) expect(stockFor(index, n, null)).toBeNull();
    // With a code, an ETF is a page like any other
    expect(stockFor(buildStockIndex([row(1, '元大台灣50 ETF', '0050')]), '元大台灣50 ETF', '0050')!.slug).toBe('0050');
  });

  it('gives a company that listed later its code, on rows from before', () => {
    const index = buildStockIndex([row(713, 'SpaceX', null), row(712, 'SpaceX', null)]);
    expect(findStock(index, 'SPCX')).toMatchObject({ slug: 'SPCX', name: 'SpaceX', code: 'SPCX', market: 'us' });
    // The old URL still finds it
    expect(findStock(index, 'spacex')!.slug).toBe('SPCX');
    expect(stockFor(index, 'SpaceX', null)!.episodes).toHaveLength(2);
  });

  it('joins the names of one company that has no code', () => {
    const index = buildStockIndex([row(713, 'Nexperia', null), row(712, '安世半導體', null), row(711, 'Nexperia 安世半導體', null), row(710, 'xAI（Grok）', null), row(709, 'xAI', null)]);
    expect(findStock(index, 'nexperia')!.episodes.map((e) => e.no)).toEqual([713, 712, 711]);
    expect(stockFor(index, '安世半導體', null)!.name).toBe('Nexperia');
    expect(findStock(index, 'xai')!.episodes).toHaveLength(2);
    // And a name whose alias has a code joins the code
    expect(stockFor(buildStockIndex([row(2, '日東紡', '3110.T'), row(1, 'Nitto Boseki', null)]), 'Nitto Boseki', null)!.slug).toBe('3110.T');
  });

  it('takes a name for a code only when it is nothing else', () => {
    const index = buildStockIndex([row(713, '安森美', 'ON'), row(712, 'ON／STM', null), row(711, 'ON 概念股', null), row(710, 'ON semi', null)]);
    expect(findStock(index, 'ON')!.episodes.map((e) => e.no)).toEqual([713]);
    expect(stockFor(index, 'ON／STM', null)).toBeNull();
    expect(stockFor(index, 'ON semi', null)!.slug).toBe('on semi');
    expect(findStock(index, 'ON anything')).toBeNull();
  });

  it('keeps one episode per page with its notes in order, dropping a repeated note', () => {
    const index = buildStockIndex([
      row(713, 'Google', 'GOOGL', '談 Gemini', 900),
      row(713, 'Alphabet', 'GOOG', '談 TPU', 300),
      row(713, 'Alphabet／Google', 'GOOGL', '談 TPU', 320),
    ]);
    const stock = findStock(index, 'GOOGL')!;
    expect(stock.episodes).toHaveLength(1);
    expect(stock.episodes[0]!.notes).toEqual([
      { t: 300, text: '談 TPU' },
      { t: 900, text: '談 Gemini' },
    ]);
  });

  it('sorts markets apart', () => {
    const index = buildStockIndex([row(1, '台積電', '2330'), row(1, '正2', '00631L'), row(1, '波克夏', 'BRK.B'), row(1, '三星電子', '005930.KS'), row(1, 'OpenAI', null)]);
    expect([...index.byKey.values()].map((s) => s.market)).toEqual(['tw', 'tw', 'us', 'other', 'none']);
    // A one-letter suffix other than a share class is an exchange
    expect(findStock(buildStockIndex([row(1, 'IQE', 'IQE.L')]), 'IQE.L')!.market).toBe('other');
  });
});

describe('findStock', () => {
  const index = buildStockIndex([row(713, '台積電', '2330'), row(712, 'OpenAI', null), row(711, '三星', '005930.KS')]);

  it('finds a page by any spelling of its code or name', () => {
    for (const s of ['2330', 'tsm', 'TSM', '2330.TW', '台積電']) expect(findStock(index, s)?.slug).toBe('2330');
    for (const s of ['OpenAI', 'openai', 'OPENAI']) expect(findStock(index, s)?.slug).toBe('openai');
    expect(findStock(index, '三星')?.slug).toBe('005930.KS');
  });

  it('has nothing for a name no episode has', () => {
    for (const s of ['Rivian', '9999', '', '../etc']) expect(findStock(index, s)).toBeNull();
  });

  it('encodes a slug that is not plain ASCII', () => {
    const dji = buildStockIndex([row(1, '大疆 DJI', null)]);
    const href = stockHref(findStock(dji, '大疆 DJI')!);
    expect(href).toBe('/stock/%E5%A4%A7%E7%96%86%20dji');
    // And the page finds itself from what the router decodes
    expect(findStock(dji, decodeURIComponent(href.slice('/stock/'.length)))?.name).toBe('大疆 DJI');
  });
});

describe('listedStocks', () => {
  const index = buildStockIndex([
    // 輝達 has the most episodes and still comes after AMD: by code, not by count
    row(713, '輝達', 'NVDA'), row(712, '輝達', 'NVDA'), row(711, '輝達', 'NVDA'),
    row(713, 'AMD', 'AMD'), row(712, 'AMD', 'AMD'),
    row(713, '聯發科', '2454'), row(712, '聯發科', '2454'),
    row(713, '台積電', '2330'), row(710, '台積電', 'TSM'),
    row(713, 'xAI', null), row(712, 'xAI', null),
    row(713, 'OpenAI', null), row(712, 'OpenAI', null),
    // One episode only
    row(713, '鴻海', '2317'),
    row(713, 'Waymo', null),
  ]);

  it('lists pages with two episodes or more, by market, then by code or name', () => {
    expect(listedStocks(index).map((g) => [g.market, g.stocks.map((s) => s.slug)])).toEqual([
      ['tw', ['2330', '2454']],
      ['us', ['AMD', 'NVDA']],
      ['none', ['openai', 'xai']],
    ]);
  });

  it('leaves a one-episode page reachable but unlisted', () => {
    expect(findStock(index, '2317')!.episodes).toHaveLength(1);
    expect(listedStocks(index).flatMap((g) => g.stocks).some((s) => s.slug === '2317')).toBe(false);
  });
});

describe('what an episode says about a stock', () => {
  const outline: EpisodeOutline = {
    keys: [{ t: 700, text: '輝達財報後的市場反應' }],
    chapters: [
      { t: 0, title: '開場業配', ad: true, bullets: [{ t: 10, text: 'Meta 眼鏡的業配' }] },
      { t: 600, title: '輝達風波', ad: false, bullets: [{ t: 625, text: '輝達受黃仁勳事件影響' }, { t: 700, text: '輝達中國營收' }, { t: 760, text: 'NVIDIA 的 guidance' }] },
      { t: 1200, title: '市場問答', ad: false, bullets: [{ t: 1210, text: '談台積電法說' }, { t: 1300, text: 'metaverse 沒人提了' }] },
    ],
  };
  const index = buildStockIndex(
    [
      row(713, '輝達', 'NVDA', '談事件的影響', 610),
      row(712, 'NVIDIA', 'NVDA', '順帶一提', 60),
      row(713, '台積電', '2330', '提到法說', 1210),
      row(713, 'Meta', 'META', '帶過一句', 1250),
      row(713, 'Cloudflare', 'NET', '帶過一句', 1260),
    ],
    new Map([[713, outline]]),
  );
  const ep = (slug: string, no = 713) => findStock(index, slug)!.episodes.find((e) => e.no === no)!;

  it('names the chapters its notes fall in', () => {
    expect(ep('NVDA').chapters).toEqual(['輝達風波']);
    expect(ep('2330').chapters).toEqual(['市場問答']);
  });

  it('adds the summary bullets that name it by any of its names, but not its notes again', () => {
    // The bullet at 625 is the note's passage (610) again; NVIDIA is a name another episode uses
    expect(ep('NVDA').points).toEqual([
      { t: 700, text: '輝達中國營收' },
      { t: 760, text: 'NVIDIA 的 guidance' },
    ]);
    expect(ep('2330').points).toEqual([]);
  });

  it('marks an episode that dwells on it: a chapter title, a key point, or several bullets', () => {
    expect(ep('NVDA').deep).toBe(true);
    expect(ep('2330').deep).toBe(false);
  });

  it('matches Latin names as words, never codes, and never an ad chapter', () => {
    // "metaverse" is not Meta, the ad's bullet doesn't count, and NET is not in any text
    expect(ep('META')).toMatchObject({ points: [], deep: false, chapters: ['市場問答'] });
    expect(ep('NET')).toMatchObject({ points: [], deep: false });
  });

  it('gives a note inside an ad chapter no chapter, and skips a row named by its code', () => {
    const ads: EpisodeOutline = {
      keys: [{ t: 0, text: 'NET 這個字只是英文單字 net' }],
      chapters: [
        { t: 0, title: '市場問答', ad: false, bullets: [] },
        { t: 100, title: '業配', ad: true, bullets: [] },
      ],
    };
    const i = buildStockIndex([row(1, 'Cloudflare', 'NET', '在業配裡帶到', 150), row(2, 'NET', 'NET', '', 10)], new Map([[1, ads]]));
    expect(findStock(i, 'NET')!.episodes.find((e) => e.no === 1)).toMatchObject({ chapters: [], deep: false });
  });

  it('leaves an episode without a summary with just its notes', () => {
    expect(ep('NVDA', 712)).toMatchObject({ chapters: [], points: [], deep: false });
  });
});

describe('coMentioned', () => {
  // 輝達 is in every episode; Credo and Astera come up together; Lumentum shares too few
  const eps = (name: string, code: string, nos: number[]) => nos.map((no) => row(no, name, code));
  const index = buildStockIndex([
    ...eps('輝達', 'NVDA', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
    ...eps('Credo', 'CRDO', [1, 2, 3, 4]),
    ...eps('Astera Labs', 'ALAB', [1, 2, 3, 5]),
    ...eps('Marvell', 'MRVL', [1, 2, 3, 4, 6, 7, 8, 9]),
    ...eps('Lumentum', 'LITE', [1, 2, 10]),
    ...eps('台光電', '2383', [2, 3, 4]),
    ...eps('Waymo', 'WAYMO', [1]),
  ]);
  const names = (slug: string) => coMentioned(index, findStock(index, slug)!).map((s) => s.name);

  it('lists pages sharing three episodes or more, in the list’s order, not by count', () => {
    // Taiwan first, then US by code; Lumentum shares two, Waymo is not a listed page
    expect(names('CRDO')).toEqual(['台光電', 'Astera Labs', 'Marvell', '輝達']);
    expect(names('LITE')).toEqual(['輝達']);
    expect(names('WAYMO')).toEqual([]);
  });

  it('asks what he said, without a time', () => {
    expect(stockQuestion({ name: '台積電' })).toBe('主委談過台積電的什麼？');
  });

  it('keeps the closest pages when there are too many, rather than the biggest', () => {
    const many = buildStockIndex([
      ...eps('Credo', 'CRDO', [1, 2, 3, 4]),
      ...eps('輝達', 'NVDA', Array.from({ length: 150 }, (_, i) => i + 1)),
      ...Array.from({ length: 12 }, (_, i) => eps(`近鄰${i}`, `NB${String.fromCharCode(65 + i)}`, [1, 2, 3, 4])).flat(),
    ]);
    const picked = coMentioned(many, findStock(many, 'CRDO')!).map((s) => s.name);
    expect(picked).toHaveLength(12);
    expect(picked).not.toContain('輝達');
  });
});

describe('excerpts', () => {
  const seg = (start: number, text: string) => ({ start, end: start + 5, text });
  const segments = [seg(0, '開場'), seg(90, '前面在講別的'), seg(100.4, '接著說到台積電'), seg(106, '法說會的重點。'), seg(112, '再來是別的')];

  it('starts a little before the timestamp and joins segments like the transcript tab', () => {
    expect(excerptFrom(segments, 110)).toEqual({ t: 100, text: '接著說到台積電，法說會的重點。再來是別的' });
    expect(excerptFrom(segments, 0)).toEqual({ t: 0, text: '開場，前面在講別的，接著說到台積電，法說會的重點。再來是別的' });
  });

  it('stops after about 450 characters, at a segment end', () => {
    const long = Array.from({ length: 40 }, (_, i) => seg(i * 10, '這是一句二十個字左右的逐字稿內容用來測試。'));
    const text = excerptFrom(long, 100)!.text;
    expect(text.length).toBeGreaterThanOrEqual(450);
    expect(text.length).toBeLessThan(480);
    expect(text.endsWith('測試。')).toBe(true);
  });

  it('gives the tail for a timestamp past the end, and nothing without a transcript', () => {
    expect(excerptFrom(segments, 9999)).toEqual({ t: 112, text: '再來是別的' });
    expect(excerptFrom([], 10)).toBeNull();
  });
});

describe('search on /stocks', () => {
  const index = buildStockIndex([
    row(713, '台積電', '2330'), row(712, 'TSMC／台積電', '2330/TSM'), row(711, '台積電', '2330.TW/TSM'),
    row(713, '富邦台50', '006208'), row(712, '富邦台灣50', '006208'),
    row(713, '台達電', '2308'),
    row(713, 'OpenAI', null),
  ]);
  const found = (q: string) =>
    listedStocks(index, 1)
      .flatMap((g) => g.stocks)
      .filter((s) => stockMatches(stockSearchText(s), searchKey(q)))
      .map((s) => s.name);

  it('finds a page by part of its name, by another name it came with, or by a code', () => {
    // In the list's order: by code
    expect(found('台')).toEqual(['富邦台50', '台達電', '台積電']);
    expect(found('TSMC')).toEqual(['台積電']);
    expect(found('tsm')).toEqual(['台積電']);
    expect(found('006208')).toEqual(['富邦台50']);
    expect(found('2330.tw')).toEqual(['台積電']);
    expect(found('富邦台灣')).toEqual(['富邦台50']);
  });

  it('ignores case, width and spaces around the query, and reaches one-episode pages', () => {
    expect(found(' OPENAI ')).toEqual(['OpenAI']);
    expect(found('ｏｐｅｎ')).toEqual(['OpenAI']);
    expect(found('２３０８')).toEqual(['台達電']);
  });

  it('finds nothing for an empty query or a name no episode has', () => {
    expect(found('')).toEqual([]);
    expect(found('   ')).toEqual([]);
    expect(found('Rivian')).toEqual([]);
  });

  it('finds a page by the name an alias gives it, and not by junk in the code field', () => {
    const odd = buildStockIndex([row(713, '安世半導體', null), row(712, 'Cerebras', '未上市'), row(711, 'Groq', 'N/A')]);
    const names = (q: string) => [...odd.byKey.values()].filter((s) => stockMatches(stockSearchText(s), searchKey(q))).map((s) => s.name);
    expect(names('nexperia')).toEqual(['安世半導體']);
    expect(names('未上市')).toEqual([]);
    expect(findStock(odd, 'cerebras')!.aliases).toEqual([]);
  });

  it('keeps the other names and codes of a page', () => {
    expect(findStock(index, '2330')!.aliases.sort()).toEqual(['2330.TW', 'TSM', 'TSMC／台積電']);
    expect(findStock(index, 'openai')!.aliases).toEqual([]);
  });
});

describe('stockMonths', () => {
  const at = (episodeNo: number, publishedAt: string): StockRow => ({ ...row(episodeNo, '台積電', '2330'), publishedAt });
  const stock = findStock(
    buildStockIndex([at(713, '2026-11-11T04:00:00Z'), at(712, '2026-11-07T04:00:00Z'), at(690, '2026-08-01T04:00:00Z'), at(660, '2025-12-31T17:00:00Z')]),
    '2330',
  )!;

  it('counts episodes per Taipei month across the months the site has, oldest first', () => {
    // 2025-12-31 17:00Z is already January in Taipei
    const live = new Map([['2025-12', 4], ['2026-01', 9], ['2026-02', 8], ['2026-08', 9], ['2026-11', 3]]);
    const months = stockMonths(stock, live);
    expect(months.map((m) => m.key)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(months.filter((m) => m.mentioned > 0)).toEqual([
      { key: '2026-01', mentioned: 1, episodes: 9 },
      { key: '2026-08', mentioned: 1, episodes: 9 },
      { key: '2026-11', mentioned: 2, episodes: 3 },
    ]);
    // A month with episodes but no mention is not a month the site lacks
    expect(months[0]).toEqual({ key: '2025-12', mentioned: 0, episodes: 4 });
    expect(months[3]).toEqual({ key: '2026-03', mentioned: 0, episodes: 0 });
  });

  it('has nothing to chart without episodes, and skips a month from a date that did not parse', () => {
    expect(stockMonths(stock, new Map())).toEqual([]);
    expect(stockMonths(stock, new Map([['NaN-NaN', 1], ['2026-11', 3]])).map((m) => m.key)).toEqual(['2026-11']);
  });

  it('lists episodes by date, whatever their numbers', () => {
    // EP648 was re-uploaded after EP650
    const s = findStock(buildStockIndex([at(650, '2026-03-01T04:00:00Z'), at(649, '2026-02-27T04:00:00Z'), at(648, '2026-03-02T04:00:00Z')]), '2330')!;
    expect(s.episodes.map((e) => e.no)).toEqual([648, 650, 649]);
  });

  it('draws a bar per month while they fit, then per quarter, then per year', () => {
    const live = (from: string) => new Map([[from, 5], ['2026-11', 3]]);
    // 12 months: one bar each, linking to its own month
    const monthly = chartBars(stockMonths(stock, live('2025-12')));
    expect(monthly).toHaveLength(12);
    expect(monthly.at(-1)).toEqual({ label: '2026 年 11 月', year: '2026', mentioned: 2, episodes: 3, target: '2026-11' });
    expect(monthly[0]).toMatchObject({ label: '2025 年 12 月', mentioned: 0, episodes: 5, target: null });

    // 59 months: calendar quarters, a bar linking to its newest month with a mention
    const quarterly = chartBars(stockMonths(stock, live('2022-01')));
    expect(quarterly).toHaveLength(20);
    expect(quarterly.at(-1)).toMatchObject({ label: '2026 年 10–12 月', mentioned: 2, target: '2026-11' });
    expect(quarterly.at(-2)).toMatchObject({ label: '2026 年 7–9 月', mentioned: 1, target: '2026-08' });
    expect(quarterly.reduce((n, b) => n + b.mentioned, 0)).toBe(4);

    // 131 months: years
    const yearly = chartBars(stockMonths(stock, live('2016-01')));
    expect(yearly.map((b) => b.label)).toEqual(['2016 年', '2017 年', '2018 年', '2019 年', '2020 年', '2021 年', '2022 年', '2023 年', '2024 年', '2025 年', '2026 年']);
    expect(yearly.at(-1)).toMatchObject({ mentioned: 4, target: '2026-11' });
  });
});

describe('stock page titles', () => {
  const index = buildStockIndex([
    row(713, '台積電', '2330'), row(712, '台積電', '2330'), row(710, '台積電', '2330'), row(705, '台積電', '2330'),
    row(713, 'OpenAI', null),
    row(713, 'VTI', 'VTI'),
  ]);

  it('leads with 股癌 and the name, with the code when it adds something', () => {
    expect(stockTitle(findStock(index, '2330')!)).toBe('股癌 台積電（2330）｜在 4 集提到');
    expect(stockTitle(findStock(index, 'OpenAI')!)).toBe('股癌 OpenAI｜在 1 集提到');
    expect(stockName(findStock(index, 'VTI')!)).toBe('VTI');
  });

  it('describes where it comes up, with the newest episodes', () => {
    expect(stockDescription(findStock(index, '2330')!)).toBe(
      '《股癌》主持人在 EP713、EP712、EP710 等 4 集提到台積電（2330）：每一集說了什麼、在第幾分鐘。非官方粉絲整理，不是投資建議。',
    );
    expect(stockDescription(findStock(index, 'OpenAI')!)).toContain('主持人在 EP713 提到OpenAI：');
  });
});

describe('stockRows', () => {
  function seed(): DB {
    const db = openDb(':memory:', { migrate: true });
    const ep = db.prepare(`INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, status) VALUES (?, ?, '⭐', ?, 'https://x', ?)`);
    const mention = db.prepare('INSERT INTO mentions (episode_id, category, name, code, detail, quote, start_sec) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const live = ep.run(713, 'g713', '2026-11-07T04:00:00Z', 'done').lastInsertRowid;
    const older = ep.run(712, 'g712', '2026-11-04T04:00:00Z', 'done').lastInsertRowid;
    const failed = ep.run(714, 'g714', '2026-11-11T04:00:00Z', 'failed').lastInsertRowid;
    mention.run(older, '股票', '台積電', 'TSM', '談先進製程', null, 500);
    mention.run(live, '股票', '台積電', '2330', '談法說會', null, 900);
    mention.run(live, '股票', '輝達', 'NVDA', '談 GTC', null, 300);
    mention.run(live, '美食', '拉麵', null, null, '很好吃', 100);
    mention.run(failed, '股票', '台積電', '2330', '還沒上線', null, 10);
    return db;
  }

  it('reads live episodes’ stock rows, newest episode first, in the order they come up', () => {
    const rows = stockRows(seed());
    expect(rows.map((r) => [r.episodeNo, r.name, r.startSec])).toEqual([
      [713, '輝達', 300],
      [713, '台積電', 900],
      [712, '台積電', 500],
    ]);
    expect(rows[1]).toMatchObject({ code: '2330', detail: '談法說會', title: '⭐', publishedAt: '2026-11-07T04:00:00Z' });
  });

  it('reads excerpts and outlines of live episodes only', () => {
    const db = seed();
    const summary = { line: '', keys: [{ t: 5, text: '重點' }], chapters: [{ t: 0, title: '章', ad: false, bullets: [{ t: 1, text: '條' }], quote: null }], stocks: [], mentions: [] };
    const segments = JSON.stringify([{ start: 890, end: 895, text: '談台積電法說會' }]);
    db.prepare(`UPDATE episodes SET segments_json = ?, summary_json = ?`).run(segments, JSON.stringify(summary));
    // No seek table yet: the audio plays from the time as it is
    expect(excerptAt(db, 713, 900)).toEqual({ t: 890, text: '談台積電法說會', point: null });
    // EP714 hasn't gone live; EP1 doesn't exist
    expect(excerptAt(db, 714, 900)).toBeNull();
    expect(excerptAt(db, 1, 900)).toBeNull();
    expect([...episodeOutlines(db).keys()].sort()).toEqual([712, 713]);
    // A broken summary costs that episode its outline, not every page
    db.prepare(`UPDATE episodes SET summary_json = '{"line":' WHERE episode_no = 712`).run();
    expect([...episodeOutlines(db).keys()]).toEqual([713]);
    db.prepare(`UPDATE episodes SET summary_json = '{}' WHERE episode_no = 712`).run();
    expect(episodeOutlines(db).get(712)).toEqual({ keys: [], chapters: [], line: '' });
    db.prepare(`UPDATE episodes SET summary_json = ? WHERE episode_no = 712`).run(JSON.stringify(summary));
    expect(episodeOutlines(db).get(713)).toEqual({ keys: [{ t: 5, text: '重點' }], chapters: [{ t: 0, title: '章', ad: false, bullets: [{ t: 1, text: '條' }] }], line: '' });
  });

  it('gives each timestamp on a page where to start the audio, from the episode’s seek table', () => {
    const db = seed();
    // Every seek in EP712 lands 2 s late; EP713 has no table
    const table = { duration: 3000, offsets: Array<number>(1001).fill(2) };
    db.prepare(`UPDATE episodes SET seek_json = ? WHERE episode_no = 712`).run(JSON.stringify(table));
    const stock = findStock(buildStockIndex(stockRows(db)), '2330')!;
    const points = stockPlayPoints(db, stock);
    expect(points.get('712:500')).toEqual({ entry: [498, 2], interp: [498, 2] });
    expect(points.get('713:900')).toBeNull();
    expect(stock.episodes[0]!.audioUrl).toBe('https://x');
    // EP713's table arrives later (the worker doesn't touch updated_at for it): picked up
    db.prepare(`UPDATE episodes SET seek_json = ? WHERE episode_no = 713`).run(JSON.stringify(table));
    expect(stockPlayPoints(db, stock).get('713:900')).toEqual({ entry: [898, 2], interp: [898, 2] });
    expect(excerptAt(db, 713, 900)).toBeNull();
  });

  it('counts live episodes per Taipei month', () => {
    expect([...liveMonths(seed())]).toEqual([['2026-11', 2]]);
  });

  it('builds the index the pages read, again only after an episode changes', async () => {
    const db = seed();
    mocks.db = db;
    const index = await stockIndex();
    const stock = findStock(index, 'tsm')!;
    expect(stock.episodes.map((e) => e.no)).toEqual([713, 712]);
    expect(stock.episodes[0]!.notes).toEqual([{ t: 900, text: '談法說會' }]);

    // A logged question changes the database but not the pages
    db.prepare(`INSERT INTO ask_usage (user_id, date, count) VALUES ('u', '2026-11-12', 1)`).run();
    expect(await stockIndex()).toBe(index);

    // EP714 goes live
    db.prepare(`UPDATE episodes SET status = 'done', updated_at = '2026-11-12T00:00:00Z' WHERE episode_no = 714`).run();
    expect(findStock(await stockIndex(), '2330')!.episodes.map((e) => e.no)).toEqual([714, 713, 712]);
  });
});
