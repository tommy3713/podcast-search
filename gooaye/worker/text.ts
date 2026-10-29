import * as OpenCC from 'opencc-js';

// Simplified → Traditional characters only (s2tw). Not twp: phrase conversion rewrites
// what the speaker actually said (代碼→程式碼, 信息→資訊).
const toTw = OpenCC.Converter({ from: 'cn', to: 'tw' });

// Known mishearings of names on the show
const FIXES: [string, string][] = [
  ['聖風宮', '謝孟恭'],
  ['謝夢恭', '謝孟恭'],
  ['沈夢恭', '謝孟恭'],
  ['孫悟空', '謝孟恭'],
  ['谷海', '股癌'],
  ['古愛', '股癌'],
  // s2tw maps 里 one-to-one and misses 裡 in 里面
  ['里面', '裡面'],
  // OpenCC turns 台 into 臺; Taiwan usage (台股, 台積電) is 台
  ['臺', '台'],
];

const HALF_TO_FULL: Record<string, string> = { ',': '，', '?': '？', '!': '！', ':': '：', ';': '；' };
const CJK_PUNCT = /(?<=[一-鿿])[,?!:;]|[,?!:;](?=[一-鿿])/g;

export function normalizeText(s: string): string {
  let t = toTw(s.trim());
  for (const [wrong, right] of FIXES) t = t.replaceAll(wrong, right);
  return t.replace(CJK_PUNCT, (c) => HALF_TO_FULL[c] ?? c);
}

export const WHISPER_PROMPT =
  '歡迎收聽股癌，我是謝孟恭。今天聊聊台股、美股，Fed 跟聯準會的升息、降息，還有通膨、殖利率、ETF。半導體方面有台積電、輝達 NVIDIA、蘋果、Google、Meta、特斯拉。';
