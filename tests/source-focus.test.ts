import { describe, expect, it } from 'vitest';
import type { Source } from '@/lib/ask/agent';
import { findWords, previewParts, quotesIn, sourceFocus, sourceHref, termFocus } from '@/lib/ask/focus';
import { otherSources, OTHER_SOURCES_SHOWN, parseAnswer } from '@/lib/ask/render';
import { groupParagraphs, matchStarts, placeParagraphs } from '@/lib/format';
import type { Segment } from '@/lib/segments';
import { findFocus, MAX_HIGHLIGHT_CHARS, parseHighlight } from '@/lib/transcript-focus';

const seg = (start: number, text: string): Segment => ({ start, end: start + 5, text });

// Shaped after EP609 43:12–44:20: a wallet ad, then a listener's message naming 秋口 twice
const segments = [
  seg(2592.4, '我目前用到現在認為是最好的皮夾'),
  seg(2600, '所以非常喜歡皮夾。'),
  seg(2623.6, '只是我就覺得說長夾比較秀氣一點'),
  seg(2640, '經歷秋口幹你娘、媽媽剪破衣服'),
  seg(2655.2, '祝諾安哥快快樂樂長大'),
  seg(2658, '秋口繼續幹你娘愛你，兄弟我愛你。'),
];

describe('placeParagraphs', () => {
  it('groups like groupParagraphs and knows where each segment begins in the text', () => {
    const placed = placeParagraphs(segments);
    expect(placed.map(({ start, text }) => ({ start, text }))).toEqual(groupParagraphs(segments));
    // 皮夾 had no punctuation, so a comma joins it: the next segment begins one further on
    expect(placed[0]!.segs).toEqual([
      { at: 0, start: 2592.4 },
      { at: '我目前用到現在認為是最好的皮夾，'.length, start: 2600 },
    ]);
    for (const p of placed) for (const s of p.segs) expect(p.text.slice(s.at).startsWith(segments.find((x) => x.start === s.start)!.text)).toBe(true);
    expect(placed.flatMap((p) => p.segs)).toHaveLength(segments.length);
  });
});

describe('matchStarts', () => {
  it('finds case-insensitive matches without overlaps', () => {
    expect(matchStarts('aAa', 'aa')).toEqual([0]);
    expect(matchStarts('Meta meta', 'META')).toEqual([0, 5]);
    expect(matchStarts('abc', '')).toEqual([]);
  });
});

describe('parseHighlight', () => {
  it('takes a short quote and refuses the rest', () => {
    expect(parseHighlight(' 秋口  幹你娘 ')).toBe('秋口 幹你娘');
    expect(parseHighlight('')).toBeNull();
    expect(parseHighlight(undefined)).toBeNull();
    expect(parseHighlight(['a', 'b'])).toBeNull();
    expect(parseHighlight('字'.repeat(MAX_HIGHLIGHT_CHARS))).not.toBeNull();
    expect(parseHighlight('字'.repeat(MAX_HIGHLIGHT_CHARS + 1))).toBeNull();
  });
});

describe('findFocus', () => {
  it('opens at the segment holding the words, on the search mark the link means', () => {
    // The source's passage starts at 43:12 (2592); the words are a minute further on
    expect(findFocus(segments, 2592, '秋口繼續幹你娘')).toEqual({ t: 2658, text: '秋口繼續幹你娘', hit: 0 });
    // 秋口 is in the transcript at 2640 and 2658: a link from 2645 means the second
    expect(findFocus(segments, 2645, '秋口')).toEqual({ t: 2658, text: '秋口', hit: 1 });
    expect(findFocus(segments, 2592, '秋口')).toEqual({ t: 2640, text: '秋口', hit: 0 });
  });

  it('counts the marks the way the transcript search does, case ignored', () => {
    const segs = [seg(0, 'Meta 跟 meta'), seg(40, 'META')];
    expect(findFocus(segs, 30, 'meta')).toEqual({ t: 40, text: 'meta', hit: 2 });
  });

  it('skips a match inside a longer Latin word but still counts its mark', () => {
    const segs = [seg(0, 'again 我們講 AI')];
    expect(findFocus(segs, 0, 'ai')).toEqual({ t: 0, text: 'ai', hit: 1 });
  });

  it('looks for the longest piece when the words span two paragraphs', () => {
    // 媽媽剪破衣服 ends one paragraph and 祝諾安哥 starts the next: pieces of equal length go
    // in order, so it opens where the quote begins
    expect(findFocus(segments, 2592, '剪破衣服，祝諾安哥')).toEqual({ t: 2640, text: '剪破衣服', hit: 0 });
    expect(findFocus(segments, 2592, '衣服，祝諾安哥快快')).toEqual({ t: 2655.2, text: '祝諾安哥快快', hit: 0 });
  });

  it('takes a match just before the time when none follows, and nothing far away', () => {
    // a mention's time can be a little late
    expect(findFocus(segments, 2662, '秋口')).toEqual({ t: 2658, text: '秋口', hit: 1 });
    expect(findFocus(segments, 2700, '皮夾')).toBeNull();
    expect(findFocus(segments, 2000, '秋口')).toBeNull();
    expect(findFocus(segments, 2592, '沒有這句')).toBeNull();
  });
});

const source = (n: number, text: string, extra: Partial<Source> = {}): Source => ({ n, ep: 609, t: 2592, text, label: null, ...extra });
const passage = '我目前用到現在認為是最好的皮夾，所以非常喜歡皮夾。只是我就覺得說長夾比較秀氣一點，經歷秋口幹你娘、媽媽剪破衣服，祝諾安哥快快樂樂長大，秋口繼續幹你娘愛你，兄弟我愛你。';

describe('quotesIn / findWords', () => {
  it('reads the quotes of a line', () => {
    expect(quotesIn('他說「秋口繼續幹你娘」和『兄弟』，還有“OK”跟「我」')).toEqual(['秋口繼續幹你娘', '兄弟', 'OK']);
  });

  it('finds a quote, or the longest piece of one the model shortened', () => {
    expect(findWords(passage, '秋口繼續幹你娘')).toEqual({ at: passage.indexOf('秋口繼續'), text: '秋口繼續幹你娘', whole: true });
    // 長夾 alone is too short a piece to trust
    expect(findWords(passage, '長夾…秀氣一點')).toEqual({ at: passage.indexOf('秀氣一點'), text: '秀氣一點', whole: false });
    expect(findWords('I love NVIDIA', 'nvidia')).toEqual({ at: 7, text: 'NVIDIA', whole: true });
    expect(findWords(passage, '沒有這句')).toBeNull();
  });

  it('matches Latin words whole, and keeps positions after characters toLowerCase lengthens', () => {
    expect(findWords('again 講到 AI 伺服器', 'ai')).toMatchObject({ at: 9, text: 'AI' });
    expect(findWords('İstanbul 的 NVIDIA', 'nvidia')).toMatchObject({ at: 11, text: 'NVIDIA' });
    expect(findWords('iPhone', 'ON')).toBeNull();
  });

  it('reads a quote inside a quote', () => {
    expect(quotesIn('他說「朋友說『可以試看看』」')).toEqual(['朋友說『可以試看看』', '可以試看看']);
    expect(findWords('聽眾說可以試看看', '朋友說『可以試看看』')).toMatchObject({ text: '可以試看看', whole: false });
  });

  it('cuts long words to what a link takes', () => {
    const long = '字'.repeat(60);
    expect([...findWords(long, long)!.text]).toHaveLength(MAX_HIGHLIGHT_CHARS);
  });
});

describe('sourceFocus', () => {
  const sources = {
    1: source(1, passage, { terms: ['皮夾'] }),
    2: source(2, '台積電法說會說毛利率會再往上', { t: 125.5, ep: 709, terms: ['法說會'] }),
    3: source(3, '完全無關的段落'),
  };
  const focusOf = (answer: string) => sourceFocus(parseAnswer(answer, new Set([1, 2, 3])), sources);

  it('uses what the citing line quotes from the passage, before the search terms', () => {
    const f = focusOf('- 「秋口繼續幹你娘」 [1]\n- 法說會 [2]');
    expect(f.get(1)).toEqual({ at: passage.indexOf('秋口繼續'), text: '秋口繼續幹你娘' });
    // no quote: the terms the search found in it
    expect(f.get(2)).toEqual({ at: 3, text: '法說會' });
  });

  it('takes the earliest of several quotes, and leaves out a source with nothing to point at', () => {
    const f = focusOf('他說「秋口繼續幹你娘」，也提到「秋口幹你娘」 [1][3]');
    expect(f.get(1)!.text).toBe('秋口幹你娘');
    expect(f.has(3)).toBe(false);
  });

  it('prefers a quote found whole over a short piece of another found earlier', () => {
    // 我覺得 opens the passage, but it is only a piece of a quote the model changed
    const s = { 1: source(1, '我覺得今天很冷。後來他說可以再試看看') };
    const f = sourceFocus(parseAnswer('他說「我覺得…再試試」，也說「可以再試看看」 [1]', new Set([1])), s);
    expect(f.get(1)!.text).toBe('可以再試看看');
  });

  it('gives each citation the quotes written before it', () => {
    const s = { 1: source(1, '法說會之前，台積電的營收'), 2: source(2, '這次法說會講毛利率') };
    const f = sourceFocus(parseAnswer('他說「台積電」[1]，也講到「法說會」[2]', new Set([1, 2])), s);
    // 法說會 is earlier in [1]'s passage, but it is [2]'s quote
    expect(f.get(1)!.text).toBe('台積電');
    expect(f.get(2)!.text).toBe('法說會');
  });

  it('ignores a quote another line makes', () => {
    expect(focusOf('「秋口繼續幹你娘」\n他講到皮夾 [1]').get(1)!.text).toBe('皮夾');
  });
});

describe('sourceHref / previewParts', () => {
  it('links the words, or just the time without them', () => {
    const s = source(2, 'x', { ep: 709, t: 125.5 });
    const href = sourceHref(s, { at: 0, text: '秋口 幹&你娘' });
    expect(href.startsWith('/ep/709?t=125&hl=')).toBe(true);
    expect(new URL(href, 'https://x').searchParams.get('hl')).toBe('秋口 幹&你娘');
    expect(sourceHref(s, undefined)).toBe('/ep/709?t=125');
  });

  it('starts the preview a little before the words', () => {
    const at = passage.indexOf('秋口繼續');
    const p = previewParts(passage, { at, text: '秋口繼續幹你娘' });
    expect(p.before).toBe(`…${passage.slice(at - 12, at)}`);
    expect(p.words).toBe('秋口繼續幹你娘');
    expect(p.after.startsWith('愛你')).toBe(true);
    expect(previewParts('短', { at: 0, text: '短' })).toEqual({ before: '', words: '短', after: '' });
    expect(previewParts(passage, undefined)).toEqual({ before: passage, words: '', after: '' });
  });
});

describe('termFocus', () => {
  it('points at the first search term the passage holds, or nowhere', () => {
    expect(termFocus(source(1, '他說法說會之後台積電會漲', { terms: ['台積電', '法說會'] }))).toEqual({ at: 2, text: '法說會' });
    expect(termFocus(source(1, '完全無關的段落', { terms: ['台積電'] }))).toBeUndefined();
    expect(termFocus(source(1, '沒有搜尋詞'))).toBeUndefined();
  });
});

describe('otherSources', () => {
  it('lists the uncited sources in the order they were found', () => {
    const all = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, source(i + 1, `段落 ${i + 1}`, { ep: 600 + i })]));
    expect(otherSources(all, [2, 5]).map((s) => s.n)).toEqual([1, 3, 4, 6, 7, 8, 9, 10, 11, 12]);
    expect(otherSources({ 1: all[1]! }, [1])).toEqual([]);
  });

  it('leaves out passages next to a cited one in the same episode', () => {
    const near = {
      1: source(1, '球隊把東京巨蛋租下來', { ep: 700, t: 168 }),
      2: source(2, '前一段，最後一句也說租下來', { ep: 700, t: 100 }),
      3: source(3, '東京巨蛋', { ep: 700, t: 168, label: '運動・東京巨蛋' }),
      4: source(4, '同一集，很後面', { ep: 700, t: 2400 }),
      5: source(5, '別集同一個時間', { ep: 699, t: 168 }),
    };
    expect(otherSources(near, [1]).map((s) => s.n)).toEqual([4, 5]);
  });
});
