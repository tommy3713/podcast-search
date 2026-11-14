// What the simplified → traditional conversion itself gets wrong, fixed in code for every
// transcript (worker/text.ts) and shown read-only in /admin/rules. Mishearings are rules an
// admin edits there instead (text_fixes, src/lib/rules.ts).
export const CONVERSION_FIXES: [string, string, string][] = [
  // s2tw maps 里 one-to-one and misses 裡 in 里面
  ['里面', '裡面', '簡轉繁把「里」一對一轉換，漏掉「裡面」'],
  // OpenCC turns 台 into 臺; Taiwan usage (台股, 台積電) is 台
  ['臺', '台', '簡轉繁把「台」轉成「臺」，台灣慣用「台」'],
];
