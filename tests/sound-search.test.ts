import { beforeEach, describe, expect, it } from 'vitest';
import { answer, type AskEvent, newTrace } from '@/lib/ask/agent';
import { chunksMissingPinyin, SOUND_MATCH_LIMIT, searchTranscript } from '@/lib/ask/search';
import { type DB, EMBEDDING_DIM, openDb } from '@/lib/db';
import { soundSearchable, toPinyin } from '@/lib/pinyin';
import { indexPinyin } from '../worker/pinyin-index.ts';
import { insertDiscovered, publishEpisode, savePinyin, saveSegments } from '../worker/repo.ts';

const vec = (i: number) => Array.from({ length: EMBEDDING_DIM }, (_, k) => (k === i ? 1 : 0));

function addEpisode(db: DB, no: number, publishedAt: string, chunks: string[], pointVector?: number[]) {
  insertDiscovered(db, { guid: `g${no}`, episodeNo: no, title: '⭐', publishedAt, audioUrl: 'https://x', duration: 3000 });
  const id = (db.prepare('SELECT id FROM episodes WHERE episode_no = ?').get(no) as { id: number }).id;
  saveSegments(db, id, [], 3000, 0);
  publishEpisode(db, id, {
    summary: { line: '', keys: [], chapters: [], stocks: [], mentions: [] },
    chunks: chunks.map((text, i) => ({ idx: i, startSec: i * 600, text })),
    vectors: chunks.map((_, i) => vec((no - 700) * 10 + i)),
    // one summary point spanning the episode, when given its vector
    points: pointVector ? [{ startSec: 0, endSec: null, text: '摘要' }] : [],
    pointVectors: pointVector ? [pointVector] : [],
    costUsd: 0,
  });
}

let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
  addEpisode(db, 708, '2026-10-24T07:00:00.000Z', ['四個字是哪裡來的梗啊？交言肥腸。下面一位', '台積電法說會重點']);
  addEpisode(db, 709, '2026-10-28T07:00:00.000Z', ['最近每天打網球', '那顆大股江平的球拍了 400 萬']);
});

describe('toPinyin', () => {
  it('writes toneless syllables, other runs lowercased', () => {
    expect(toPinyin('椒鹽肥腸')).toBe('jiao yan fei chang');
    expect(toPinyin('交言肥腸。下面')).toBe('jiao yan fei chang 。 xia mian');
    expect(toPinyin('Model X 很好')).toBe('model x hen hao');
    expect(toPinyin('綠色')).toBe('lv se');
  });

  it('reads characters with several sounds from their context', () => {
    // from traditional text pinyin-pro read these yin xing, huan you, chang da, dan ju
    expect(toPinyin('銀行')).toBe('yin hang');
    expect(toPinyin('還有')).toBe('hai you');
    expect(toPinyin('長大')).toBe('zhang da');
    expect(toPinyin('單車')).toBe('dan che');
  });

  it('only looks for terms of three Chinese characters or more by sound', () => {
    expect(soundSearchable('椒鹽肥腸')).toBe(true);
    expect(soundSearchable('台積電 TSMC')).toBe(true);
    // 輝達 and 回答 are both "hui da"
    expect(soundSearchable('輝達')).toBe(false);
    expect(soundSearchable('Rivian')).toBe(false);
  });
});

describe('searchTranscript by sound', () => {
  it('finds a term the transcript wrote with other characters that sound the same', () => {
    const r = searchTranscript(db, '椒鹽肥腸', null);
    expect(r.hits.map((h) => h.episodeNo)).toEqual([708]);
    expect(r.hits[0]!.text).toContain('交言肥腸');
    expect(r.soundTerms).toEqual(['椒鹽肥腸']);
    // found, so the "in no episode" note doesn't apply
    expect(r.unmatched).toBe(false);
  });

  it('matches whole syllables, three of them being enough', () => {
    expect(searchTranscript(db, '叫言肥', null).soundTerms).toEqual(['叫言肥']);
    // " xiao yan fei " would be inside " jiao yan fei " if syllables could be cut
    expect(searchTranscript(db, '小言肥', null).soundTerms).toEqual([]);
  });

  it('uses sound only for a term no chunk has', () => {
    // 台積電 is in EP708 as written: no sound lookup, nothing else comes along
    const r = searchTranscript(db, '台積電', null);
    expect(r.soundTerms).toEqual([]);
    expect(r.hits.map((h) => h.text)).toEqual(['台積電法說會重點']);
    // one term by its letters, the other by its sound
    const both = searchTranscript(db, '台積電 椒鹽肥腸', null);
    expect(both.soundTerms).toEqual(['椒鹽肥腸']);
    expect(both.hits.map((h) => h.episodeNo)).toEqual([708, 708]);
  });

  it('leaves short terms and terms nothing sounds like alone', () => {
    expect(searchTranscript(db, '網求', null).soundTerms).toEqual([]);
    const r = searchTranscript(db, '馬丘比丘', vec(90));
    expect(r.soundTerms).toEqual([]);
    expect(r.unmatched).toBe(true);
  });

  it('keeps to the scope', () => {
    expect(searchTranscript(db, '大谷江平', null).hits.map((h) => h.episodeNo)).toEqual([709]);
    expect(searchTranscript(db, '大谷江平', null, { episode: 708 }).soundTerms).toEqual([]);
  });

  it('still says a term is nowhere when its sound-matched passages don\'t make the hits', () => {
    // EP711's chunk is first by meaning in both the chunk and the summary rankings, which
    // outweighs EP708's place in the keyword ranking for the single hit asked for
    addEpisode(db, 711, '2026-11-04T07:00:00.000Z', ['跟問題無關的段落'], vec(110));
    const r = searchTranscript(db, '椒鹽肥腸', vec(110), {}, 1);
    expect(r.hits.map((h) => h.episodeNo)).toEqual([711]);
    expect(r.soundTerms).toEqual([]);
    expect(r.unmatched).toBe(true);
  });

  it('drops a sound so common it matches too many chunks', () => {
    addEpisode(db, 710, '2026-10-31T07:00:00.000Z', Array.from({ length: SOUND_MATCH_LIMIT + 1 }, (_, i) => `第 ${i} 段講交言肥腸`));
    const r = searchTranscript(db, '椒鹽肥腸', null);
    expect(r.soundTerms).toEqual([]);
    expect(r.hits).toEqual([]);
  });

  it('finds a term next to punctuation or Latin letters', () => {
    addEpisode(db, 710, '2026-10-31T07:00:00.000Z', ['他說台積電，AI四服器還會再缺']);
    expect(searchTranscript(db, 'AI伺服器', null).soundTerms).toEqual(['AI伺服器']);
  });

  it('forgets a chunk\'s pinyin with the chunk, even when another release deletes it', () => {
    const rows = () => (db.prepare('SELECT COUNT(*) AS n FROM chunks_pinyin').get() as { n: number }).n;
    expect(rows()).toBe(4);
    // what a release that doesn't know chunks_pinyin does when it re-runs an episode
    const ids = db.prepare(`SELECT c.id FROM chunks c JOIN episodes e ON e.id = c.episode_id WHERE e.episode_no = 708`).all() as { id: number }[];
    for (const { id } of ids) db.prepare('DELETE FROM chunks_vec WHERE rowid = ?').run(BigInt(id));
    db.exec(`DELETE FROM chunks WHERE episode_id = (SELECT id FROM episodes WHERE episode_no = 708)`);
    expect(rows()).toBe(2);
    expect(searchTranscript(db, '椒鹽肥腸', null).hits).toEqual([]);
    // and publishing again replaces them
    addEpisode(db, 709, '2026-10-28T07:00:00.000Z', ['交言肥腸又來了']);
    expect(rows()).toBe(1);
    expect(searchTranscript(db, '椒鹽肥腸', null).hits.map((h) => h.text)).toEqual(['交言肥腸又來了']);
  });

  it('searches without sound on a snapshot from before the pinyin index', () => {
    const old = openDb(':memory:');
    addEpisode(old, 708, '2026-10-24T07:00:00.000Z', ['交言肥腸']);
    old.exec('DROP TRIGGER chunks_pinyin_ad; DROP TABLE chunks_pinyin');
    expect(chunksMissingPinyin(old)).toBeNull();
    expect(searchTranscript(old, '椒鹽肥腸', null)).toMatchObject({ hits: [], soundTerms: [] });
    expect(chunksMissingPinyin(db)).toBe(0);
  });
});

describe('indexPinyin', () => {
  it('fills the pinyin of live chunks lacking it and leaves the rest', async () => {
    // chunks published by a release that didn't write it
    db.exec(`DELETE FROM chunks_pinyin WHERE rowid IN (SELECT id FROM chunks WHERE text LIKE '%網球%' OR text LIKE '%肥腸%')`);
    expect(searchTranscript(db, '椒鹽肥腸', null).hits).toEqual([]);
    expect(await indexPinyin(db)).toEqual({ chunks: 2, episodes: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM chunks_pinyin').get()).toEqual({ n: 4 });
    expect(searchTranscript(db, '椒鹽肥腸', null).soundTerms).toEqual(['椒鹽肥腸']);
    expect(await indexPinyin(db)).toEqual({ chunks: 0, episodes: 0 });
  });

  it('never leaves two rows for one chunk, and skips a chunk republished since it was read', () => {
    const ep708 = db.prepare(`SELECT c.id, c.text FROM chunks c JOIN episodes e ON e.id = c.episode_id WHERE e.episode_no = 708 ORDER BY c.idx`).all() as { id: number; text: string }[];
    const first = ep708[0]!;
    // written again for the same chunk: the old row goes first
    expect(savePinyin(db, [{ id: first.id, text: first.text, pinyin: 'ma qiu bi qiu' }])).toBe(1);
    expect(searchTranscript(db, '馬丘比丘', null).hits.map((h) => h.text)).toEqual([first.text]);
    expect(searchTranscript(db, '椒鹽肥腸', null).hits).toEqual([]);
    // read before a republish changed the chunk's text: skipped
    expect(savePinyin(db, [{ id: first.id, text: '舊的文字', pinyin: 'jiao yan fei chang' }])).toBe(0);
    expect(searchTranscript(db, '椒鹽肥腸', null).hits).toEqual([]);
  });
});

describe('answer', () => {
  it('tells the model which terms were found by sound, and logs them', async () => {
    const requests: any[] = [];
    let turn = 0;
    const turns = [
      { calls: [{ query: '椒鹽肥腸' }, { query: '台積電' }, { query: '椒鹽肥腸', episode: 709 }] },
      { text: 'x' },
    ];
    const client = {
      embeddings: { create: async () => ({ data: [{ embedding: vec(0) }], usage: { total_tokens: 5 } }) },
      responses: {
        stream(req: any) {
          requests.push(structuredClone(req));
          const t = turns[Math.min(turn++, turns.length - 1)]!;
          const output = [
            ...(t.text ? [{ type: 'message', content: [{ type: 'output_text', text: t.text }] }] : []),
            ...(t.calls ?? []).map((c, k) => ({
              type: 'function_call',
              call_id: `c${turn}_${k}`,
              name: 'search_transcript',
              arguments: JSON.stringify({ query: c.query, episode: c.episode ?? null, since: null, until: null }),
            })),
          ];
          return {
            async *[Symbol.asyncIterator]() {
              if (t.text) yield { type: 'response.output_text.delta', delta: t.text };
            },
            finalResponse: async () => ({ output, status: 'completed', usage: { input_tokens: 1, output_tokens: 1 } }),
          };
        },
      },
    };
    const trace = newTrace();
    const events: AskEvent[] = [];
    await answer('q', { db, client: client as any, coverage: { count: 2, oldest: 708, newest: 709, today: '2026-10-29' }, emit: (e) => events.push(e), trace });
    const outputs = requests[1].input.filter((x: any) => x.type === 'function_call_output').map((x: any) => x.output as string);
    expect(outputs[0]).toContain('交言肥腸');
    expect(outputs[0]).toContain('「椒鹽肥腸」沒有逐字出現在逐字稿裡，上面有些段落是依發音找到的');
    expect(outputs[1]).not.toContain('依發音找到');
    // within EP709 nothing sounds like it: the "in no episode" note instead
    expect(outputs[2]).not.toContain('依發音找到');
    expect(outputs[2]).toContain('沒有出現在這個範圍的任何一段逐字稿、摘要或提及裡');
    expect(trace.toolCalls.map((c) => c.sound)).toEqual([['椒鹽肥腸'], undefined, undefined]);
  });
});
