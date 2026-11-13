// Transcripts as toneless pinyin, so search can find a name the speech-to-text wrote with
// other characters that sound the same (椒鹽肥腸 written as 交言肥腸). Only the same sound
// counts: a near sound (翔 xiang for 江 jiang) doesn't match. The worker indexes each chunk
// (chunks_pinyin); the web converts the search term the same way.
import * as OpenCC from 'opencc-js';
import { pinyin } from 'pinyin-pro';

// pinyin-pro reads characters with several sounds from their context only in simplified
// text: given traditional it read 銀行 as yin xing, 還有 as huan you and 長大 as chang da.
const toCn = OpenCC.Converter({ from: 'tw', to: 'cn' });

// Syllables and other runs (Latin words, numbers) separated by spaces, lowercased.
// Punctuation is left in: the index's tokenizer (unicode61) splits on it.
export function toPinyin(text: string): string {
  return pinyin(toCn(text), { toneType: 'none', type: 'array', nonZh: 'consecutive', v: true })
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

const HAN = /\p{Script=Han}/gu;

// Two-character terms are left out: too many words share their sound (輝達 and 回答 are
// both "hui da"), so their matches would be noise more often than a misheard name.
export const MIN_SOUND_CHARS = 3;
export const soundSearchable = (term: string) => (term.match(HAN)?.length ?? 0) >= MIN_SOUND_CHARS;
