// The text the eval prints. Kept apart from the CLI so it can be tested.
import { type GoldenQuestion, needed } from './golden.ts';
import { type RetrievalRun, compareRetrieval } from './retrieval.ts';
import { type Diff, type EvalResult, failureReasons, HIT_RATE_ALARM, rate, REGRESSED_ALARM, summarize } from './score.ts';

const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const dbLine = (d: { file: string; count: number; oldest: number; newest: number }) => `${d.file} EP${d.oldest}–${d.newest}（${d.count} 集）`;
const STATUS = { pass: '通過', unstable: '不穩定', fail: '失敗' } as const;

export function reportEval(r: EvalResult, golden: GoldenQuestion[]): string {
  const s = summarize(r);
  const byId = new Map(golden.map((q) => [q.id, q]));
  const out: string[] = [];
  out.push(`/ask eval　${r.meta.startedAt}　${r.meta.sha}　資料 ${dbLine(r.meta.db)}　ask ${r.meta.askModel}　judge ${r.meta.judgeModel}　每題 ${r.meta.runs} 次${r.meta.partial ? '　（只跑部分題目）' : ''}`);
  out.push('');
  out.push('題型         題數  通過  不穩定  失敗');
  const total = { pass: 0, unstable: 0, fail: 0 };
  const row = (name: string, t: { pass: number; unstable: number; fail: number }) =>
    `${name.padEnd(11)}${String(t.pass + t.unstable + t.fail).padStart(6)}${String(t.pass).padStart(6)}${String(t.unstable).padStart(8)}${String(t.fail).padStart(6)}`;
  for (const t of s.byType) {
    out.push(row(t.type, t));
    total.pass += t.pass;
    total.unstable += t.unstable;
    total.fail += t.fail;
  }
  out.push(row('合計'.padEnd(9), total)); // two full-width characters take four columns
  out.push('');
  out.push(`檢索 hit rate　${pct(rate(s.hit))}（${s.hit.ok}/${s.hit.of} 次）`);
  out.push(`檢查點通過率　${pct(rate(s.points))}（${s.points.ok}/${s.points.of}）`);
  out.push(`出處對不上　${s.misCited.runs}/${s.misCited.of} 次${s.misCited.ids.length ? `（${s.misCited.ids.join('、')}）` : ''}`);
  if (s.errors) out.push(`⚠ ${s.errors} 次執行出錯（逾時或 API 錯誤），不算進上面兩個比率；出錯太多的結果不要當基準`);
  out.push(`安全題（要全過）　${s.safetyFailed.length ? `✗ 沒過：${s.safetyFailed.join('、')}` : '✓ 全部通過'}`);
  out.push(`成本　ask ${usd(s.askCostUsd)} + judge ${usd(s.judgeCostUsd)} = ${usd(s.askCostUsd + s.judgeCostUsd)}；每次平均搜尋 ${s.avgToolCalls.toFixed(1)} 次、${(s.avgMs / 1000).toFixed(1)} 秒`);

  const notPassed = r.questions.filter((q) => q.status !== 'pass');
  if (notPassed.length) {
    out.push('');
    out.push('沒通過的題目：');
    for (const q of notPassed) {
      const passes = q.runs.filter((x) => x.pass).length;
      out.push(`  ${q.id}　${STATUS[q.status]} ${passes}/${q.runs.length}`);
      const g = byId.get(q.id);
      if (!g) continue;
      // One line per failed check, with how many runs failed it and the first run's detail
      const reasons = new Map<string, { n: number; detail?: string }>();
      for (const run of q.runs) {
        if (run.pass) continue;
        for (const why of failureReasons(g, run)) {
          const seen = reasons.get(why.what);
          if (seen) seen.n++;
          else reasons.set(why.what, { n: 1, detail: why.detail });
        }
      }
      for (const [what, r] of reasons) out.push(`      ${what}${q.runs.length > 1 ? `（${r.n} 次）` : ''}${r.detail ? `：${r.detail}` : ''}`);
    }
  }
  return out.join('\n');
}

export function reportDiff(d: Diff, beforeName: string): string {
  const out = ['', `跟基準比（${beforeName}）：`];
  out.push(`  兩次的差別：${d.changed.length ? d.changed.join('；') : '程式、資料、模型都一樣'}`);
  // With both the code and the data different, a change can't be put down to either
  if (d.changed.some((c) => c.startsWith('程式')) && d.changed.some((c) => c.startsWith('資料'))) {
    out.push('  ⚠ 程式和資料都不一樣，分不出變化是哪一邊造成的');
  }
  const list = (label: string, ids: string[]) => {
    if (ids.length) out.push(`  ${label}：${ids.join('、')}`);
  };
  list('退步（原本每次都過，現在每次都沒過）', d.regressed);
  list('變得不穩定（原本每次都過，現在有時沒過；不算退步）', d.wobbly);
  list('修好（原本每次都沒過，現在都過）', d.fixed);
  list('題目或評分規則改過，不比較', d.rewritten);
  list('新題目', d.added);
  list('拿掉的題目', d.removed);
  const delta = d.hitRate.after - d.hitRate.before;
  out.push(`  檢索 hit rate（兩次都有的題目）：${pct(d.hitRate.before)} → ${pct(d.hitRate.after)}（${delta >= 0 ? '+' : ''}${delta.toFixed(1)}）`);
  out.push(d.alarm ? `  ⚠ 退步警訊：退步 ${REGRESSED_ALARM} 題以上，或 hit rate 掉超過 ${HIT_RATE_ALARM} 個百分點` : '  沒有退步警訊');
  return out.join('\n');
}

export function reportRetrieval(r: RetrievalRun, golden: GoldenQuestion[], before?: { run: RetrievalRun; name: string }): string {
  const byId = new Map(golden.map((q) => [q.id, q]));
  const eps = (xs: number[]) => (xs.length > 12 ? `${xs.slice(0, 12).join('、')}…共 ${xs.length} 集` : xs.join('、'));
  const out = [`/ask eval（只測檢索，關鍵字）　${r.meta.startedAt}　${r.meta.sha}　資料 ${dbLine(r.meta.db)}`, ''];
  const withEps = r.questions.filter((q) => q.ok !== null);
  for (const q of r.questions) {
    const g = byId.get(q.id)!;
    const head = q.ok === null ? '－   ' : q.ok ? 'ok  ' : 'MISS';
    const found = q.ok === null ? '' : `　${q.found.length}/${g.expect_eps.length}（要 ${needed(g)}）`;
    // Safety questions search for everyday words (台積電, 台股); every episode matches
    const others = q.others.length && q.type !== 'safety' ? `　其他符合的集數：${eps(q.others)}` : '';
    out.push(`${q.id.padEnd(11)} ${head}${found}${others}`);
    for (const l of q.overLimit) out.push(`${' '.repeat(16)}「${l.term}」符合 ${l.chunks} 個 chunk、${l.mentions} 筆提及，超過搜尋讀取的上限`);
  }
  out.push('');
  out.push(`有預期集數的 ${withEps.length} 題裡，${withEps.filter((q) => q.ok).length} 題用 queries 搜得到`);
  if (before) {
    const d = compareRetrieval(before.run, r);
    out.push('', `跟基準比（${before.name}，資料 ${dbLine(before.run.meta.db)}）：`);
    if (d.rewritten.length) out.push(`  題目的 queries 或預期集數改過，不比較：${d.rewritten.join('、')}`);
    if (d.lost.length) out.push(`  原本搜得到、現在搜不到：${d.lost.join('、')}`);
    if (d.gained.length) out.push(`  原本搜不到、現在搜得到：${d.gained.join('、')}`);
    for (const x of d.newOthers) out.push(`  ${x.id} 多了符合的集數：${eps(x.eps)}（題目可能多了一個正確答案，要重看）`);
    if (!d.lost.length && !d.gained.length && !d.newOthers.length) out.push('  沒有變化');
  }
  return out.join('\n');
}
