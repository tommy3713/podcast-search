import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WHISPER_PROMPT } from '@/lib/whisper/default-prompt.ts';

vi.mock('../worker/audio.ts', () => ({
  cutClip: vi.fn(async (_input: string, _start: number, _seconds: number, out: string) => fs.writeFileSync(out, 'clip')),
}));

const { echoChars, realChars, suspectReason, transcribe } = await import('../worker/transcribe.ts');

const seg = (start: number, end: number, text: string) => ({ start, end, text });

describe('suspectReason', () => {
  it('flags subtitle credits and video outros, not the host saying something like them', () => {
    expect(suspectReason(seg(77.5, 107.5, '請關注我們的頻道，並且按讚，分享，並且訂閱我們的頻道。'), WHISPER_PROMPT)).toBe('known');
    expect(suspectReason(seg(0, 2, '請不吝點贊 訂閱 轉發 打賞支持明鏡與點點欄目'), WHISPER_PROMPT)).toBe('known');
    expect(suspectReason(seg(0, 3, '中文字幕由 Amara.org 社群提供'), WHISPER_PROMPT)).toBe('known');
    expect(suspectReason(seg(0, 5, '這次的節目是為了分享給大家的一個最新的消息。'), WHISPER_PROMPT)).toBe('known');
    expect(suspectReason(seg(0, 3, '如果有請不吝觀念矯正。'), WHISPER_PROMPT)).toBeNull();
    expect(suspectReason(seg(0, 5, '我在個人臉書上有PO文，按讚、分享、留言就可以抽獎。'), WHISPER_PROMPT)).toBeNull();
    expect(suspectReason(seg(0, 4, '本集節目是由NordVPN贊助。'), WHISPER_PROMPT)).toBeNull();
  });

  it('flags the prompt read back, even shuffled, but not a sentence naming its companies', () => {
    expect(suspectReason(seg(0, 4, '今天聊聊台股、美股，還有通膨、殖利率、NVIDIA、特斯拉。'), WHISPER_PROMPT)).toBe('echo');
    expect(suspectReason(seg(0, 5, '這就是我們在台積電、蘋果、Google、Meta、特斯拉。'), WHISPER_PROMPT)).toBe('echo');
    expect(suspectReason(seg(0, 4, '歡迎收聽股癌，我是謝孟恭。現在時間是10月17號的下午2點18分。'), WHISPER_PROMPT)).toBeNull();
    expect(suspectReason(seg(0, 2, '一樣都可以Google，大家都可以Google。'), WHISPER_PROMPT)).toBeNull();
    expect(suspectReason(seg(0, 6, '因為大家選擇的是NVIDIA、Apple、Google、Microsoft、Tesla之類的。'), WHISPER_PROMPT)).toBeNull();
    // only against the prompt the pass was given
    expect(suspectReason(seg(0, 4, '今天聊聊台股、美股，還有通膨、殖利率、NVIDIA、特斯拉。'), undefined)).toBeNull();
  });

  it('flags one short sentence spanning a long stretch', () => {
    expect(suspectReason(seg(2216, 2246, '目前的台積電股價'), WHISPER_PROMPT)).toBe('sparse');
    expect(suspectReason(seg(0, 14, '目前的台積電股價'), WHISPER_PROMPT)).toBeNull();
    expect(suspectReason(seg(0, 20, '字'.repeat(80)), WHISPER_PROMPT)).toBeNull();
  });
});

describe('echoChars and realChars', () => {
  it('counts distinct runs of the prompt', () => {
    expect(echoChars('今天聊聊台股、美股，還有通膨、殖利率', WHISPER_PROMPT)).toBe(15);
    expect(echoChars('Google，Google', WHISPER_PROMPT)).toBe(6);
  });

  it('counts a short known hallucination as invented whole, a long segment holding one as speech', () => {
    expect(realChars(seg(0, 30, '歡迎收看！'), WHISPER_PROMPT)).toBe(0);
    const mixed = '歡迎收看。我今天有個新的想法，就是有看到櫃買真的殺得很深，所以我也會想在櫃買裡面去找一些機會。';
    expect(realChars(seg(0, 8, mixed), WHISPER_PROMPT)).toBeGreaterThan(30);
    expect(realChars(seg(0, 4, '今天聊聊台股、美股，還有通膨、殖利率、NVIDIA、特斯拉。'), WHISPER_PROMPT)).toBeLessThan(4);
    // only an echo loses the prompt's runs
    expect(realChars(seg(0, 16, '歡迎收聽股癌，我是謝孟恭。'), WHISPER_PROMPT)).toBe(11);
  });
});

describe('transcribe', () => {
  const HALLUCINATION = '請不吝點贊 訂閱 轉發 打賞支持明鏡與點點欄目';
  const SPOKEN = '這邊提供給所有有需要的朋友，那這個禮拜我姐招待我們全家跑去日月潭玩';
  let dir: string;
  // What Groq returns for a file and whether a prompt was sent, by the file's name
  let replies: (name: string, prompted: boolean) => object[];
  let calls: { name: string; prompted: boolean }[];

  const groq = (start: number, end: number, text: string, extra: object = {}) => ({ start, end, text, no_speech_prob: 0.1, avg_logprob: -0.2, ...extra });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-'));
    fs.writeFileSync(path.join(dir, 'audio.mp3'), 'audio');
    process.env.GROQ_API_KEY = 'test';
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: FormData }) => {
        const name = (init.body.get('file') as File).name;
        const prompted = init.body.has('prompt');
        calls.push({ name, prompted });
        return new Response(JSON.stringify({ segments: replies(name, prompted) }), { status: 200 });
      }),
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const run = () => transcribe([{ file: path.join(dir, 'audio.mp3'), offset: 100, duration: 45 }]);

  it('replaces an invented sentence with the span transcribed alone, without the prompt when it still fails', async () => {
    replies = (name, prompted) => {
      if (name === 'audio.mp3') return [groq(0, 5, '開頭的話。'), groq(5, 35, HALLUCINATION), groq(35, 40, '後面的話。')];
      // the clip is the segment's span (5–35): with the prompt it fails again
      if (prompted) return [groq(0, 30, '有需要可以參考看看。')];
      return [groq(0, 14, SPOKEN + SPOKEN), groq(14, 28, SPOKEN + SPOKEN)];
    };
    const { segments, billedSeconds } = await run();
    expect(segments.map((s) => s.text)).toEqual(['開頭的話。', SPOKEN + SPOKEN, SPOKEN + SPOKEN, '後面的話。']);
    expect(segments[1]).toMatchObject({ start: 105, end: 119 });
    expect(calls.map((c) => c.prompted)).toEqual([true, true, false]);
    expect(calls[1]!.name).toBe('audio.mp3.redo5.mp3');
    expect(billedSeconds).toBe(45 + 30 + 30);
    expect(fs.readdirSync(dir)).toEqual(['audio.mp3']);
  });

  it('stops after the prompted pass when it recovers the span', async () => {
    replies = (name) =>
      name === 'audio.mp3'
        ? [groq(0, 5, '開頭的話。'), groq(5, 35, '今天聊聊台股、美股，還有通膨、殖利率、NVIDIA、特斯拉。'), groq(35, 45, '後面的話。')]
        : [groq(0, 14, SPOKEN + SPOKEN), groq(14, 28, SPOKEN + SPOKEN)];
    const { segments } = await run();
    expect(segments.map((s) => s.text)).toEqual(['開頭的話。', SPOKEN + SPOKEN, SPOKEN + SPOKEN, '後面的話。']);
    expect(calls).toHaveLength(2);
  });

  it('drops an invented sentence that no pass finds speech under', async () => {
    replies = (name, prompted) =>
      name === 'audio.mp3' ? [groq(0, 5, '開頭的話。'), groq(5, 35, HALLUCINATION), groq(35, 45, '後面的話。')] : prompted ? [groq(0, 30, HALLUCINATION)] : [];
    const { segments } = await run();
    expect(segments.map((s) => s.text)).toEqual(['開頭的話。', '後面的話。']);
  });

  it('keeps words that look invented when the pass without the prompt hears them too', async () => {
    const headline = '這次的報導是關於台積電2奈米的進度。';
    replies = (name) => (name === 'audio.mp3' ? [groq(0, 5, '開頭的話。'), groq(5, 9, headline), groq(9, 45, SPOKEN.repeat(4))] : [groq(0, 4, headline)]);
    const { segments } = await run();
    expect(segments.map((s) => s.text)).toEqual(['開頭的話。', headline, SPOKEN.repeat(4)]);
    expect(calls).toHaveLength(3);
  });

  it('keeps a slow sentence that every pass hears the same, the real opening included', async () => {
    const slow = '嗯，我想一下這個問題該怎麼回答比較好';
    replies = (name) => (name === 'audio.mp3' ? [groq(0, 5, '開頭的話。'), groq(5, 35, slow), groq(35, 45, '後面的話。')] : [groq(0, 30, slow)]);
    expect((await run()).segments.map((s) => s.text)).toEqual(['開頭的話。', slow, '後面的話。']);
    expect(calls).toHaveLength(3);

    const opening = '歡迎收聽股癌，我是謝孟恭。';
    replies = (name) => (name === 'audio.mp3' ? [groq(0, 16, opening), groq(16, 45, SPOKEN.repeat(6))] : [groq(0, 16, opening)]);
    expect((await run()).segments.map((s) => s.text)).toEqual([opening, SPOKEN.repeat(6)]);
  });

  it('fills a gap, leaving out what the second pass invents there', async () => {
    replies = (name, prompted) => {
      if (name === 'audio.mp3') return [groq(0, 5, '開頭的話。'), groq(35, 45, '後面的話。')];
      // the gap's clip starts a second early (at 4)
      return prompted ? [] : [groq(1, 10, '歡迎收看！'), groq(10, 20, SPOKEN + SPOKEN), groq(20, 31, SPOKEN + SPOKEN)];
    };
    const { segments } = await run();
    expect(segments.map((s) => s.text)).toEqual(['開頭的話。', SPOKEN + SPOKEN, SPOKEN + SPOKEN, '後面的話。']);
    expect(calls[1]!.name).toBe('audio.mp3.redo4.mp3');
  });

  it('leaves a gap empty when only the pass without the prompt finds a line there', async () => {
    replies = (name, prompted) =>
      name === 'audio.mp3' ? [groq(0, 5, '開頭的話。'), groq(35, 45, '後面的話。')] : prompted ? [] : [groq(1, 5, '謝謝大家的收聽，我們下次再見，拜拜')];
    const { segments } = await run();
    expect(segments.map((s) => s.text)).toEqual(['開頭的話。', '後面的話。']);
  });

  it('redoes overlapping suspect segments as one window', async () => {
    replies = (name) =>
      name === 'audio.mp3'
        ? [groq(0, 5, '開頭的話。'), groq(5, 35, '目前的台積電股價'), groq(33, 38, HALLUCINATION), groq(38, 45, '後面的話。')]
        : [groq(0, 16, SPOKEN.repeat(3)), groq(16, 33, SPOKEN.repeat(3))];
    const { segments } = await run();
    expect(segments.map((s) => s.text)).toEqual(['開頭的話。', SPOKEN.repeat(3), SPOKEN.repeat(3), '後面的話。']);
    expect(calls).toHaveLength(2);
  });

  it('makes one pass when the prompt is empty', async () => {
    replies = (name) => (name === 'audio.mp3' ? [groq(0, 5, '開頭的話。'), groq(5, 35, HALLUCINATION), groq(35, 45, '後面的話。')] : []);
    await transcribe([{ file: path.join(dir, 'audio.mp3'), offset: 0, duration: 45 }], { prompt: '' });
    expect(calls.map((c) => c.prompted)).toEqual([false, false]);
  });
});
