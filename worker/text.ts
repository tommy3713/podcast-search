import * as OpenCC from 'opencc-js';
import { CONVERSION_FIXES } from '@/lib/text-fixes.ts';
import { replaceOpen } from '@/lib/transcript-edits.ts';

// Simplified → Traditional characters only (s2tw). Not twp: phrase conversion rewrites
// what the speaker actually said (代碼→程式碼, 信息→資訊).
const toTw = OpenCC.Converter({ from: 'cn', to: 'tw' });

const HALF_TO_FULL: Record<string, string> = { ',': '，', '?': '？', '!': '！', ':': '：', ';': '；' };
const CJK_PUNCT = /(?<=[一-鿿])[,?!:;]|[,?!:;](?=[一-鿿])/g;

// `rules`: the enabled text_fixes, [original, replacement] (mishearings, edited in
// /admin/rules). They run last, on the text as it will be saved (converted, with the
// conversion's own fixes and full-width punctuation), so a rule matches here what it matched
// in live transcripts; and like everywhere else a rule applies, words already inside its
// replacement are left alone (台積 → 台積電 doesn't touch 台積電).
export function normalizeText(s: string, rules: [string, string][] = []): string {
  let t = toTw(s.trim());
  for (const [wrong, right] of CONVERSION_FIXES) t = t.replaceAll(wrong, right);
  t = t.replace(CJK_PUNCT, (c) => HALF_TO_FULL[c] ?? c);
  for (const [wrong, right] of rules) t = replaceOpen(t, wrong, right).text;
  return t;
}

export { WHISPER_PROMPT } from '@/lib/whisper/default-prompt.ts';
