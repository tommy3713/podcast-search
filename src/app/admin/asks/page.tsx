import Link from 'next/link';
import { taipeiTime } from '@/components/admin/EditStatus';
import { Sparkline } from '@/components/Sparkline';
import {
  type AskFilter,
  askDays,
  askStats,
  type AskStats,
  listAsks,
  NOTE_LABEL,
  OUTCOME_LABEL,
  OUTCOMES,
  parseAskFilter,
  SLOW_MS,
} from '@/lib/ask/log';
import { ASK_LOG_DAYS, taipeiDate } from '@/lib/ask/quota';
import { readDb } from '@/lib/server-db';
import { requireAdmin } from '../require-admin';
import { AskFacts, OutcomePill } from '@/components/admin/AskParts';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const FLAG_LABEL = { ...NOTE_LABEL, slow: `超過 ${SLOW_MS / 1000} 秒`, broad: '擴大搜尋的回答' } as const;

// The list's query string with some keys changed (undefined drops one)
function href(f: AskFilter, change: Partial<Record<keyof AskFilter | 'before', string | number | undefined>> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...change })) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `/admin/asks?${s}` : '/admin/asks';
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

function Totals({ title, s, f }: { title: string; s: AskStats; f: AskFilter }) {
  const finished = s.answered + s.no_source;
  return (
    <section className="admin-ask-totals">
      <h2>{title}</h2>
      <dl className="stat-row">
        <div>
          <dt>題數</dt>
          <dd>
            {s.asks}
            <span className="pre">・{s.users} 人</span>
          </dd>
        </div>
        <div>
          <dt>有出處</dt>
          <dd>{pct(s.answered, finished)}</dd>
        </div>
        <div>
          <dt>沒出處</dt>
          <dd>
            <Link href={href({ since: f.since, outcome: 'no_source' })}>{s.no_source}</Link>
          </dd>
        </div>
        <div>
          <dt>失敗・不當・配額</dt>
          <dd>
            <Link href={href({ since: f.since, outcome: 'failed' })}>{s.failed}</Link>
            <span className="pre">
              ・{s.moderated}・{s.quota}
            </span>
          </dd>
        </div>
        <div>
          <dt>平均</dt>
          <dd>
            {s.avg_ms === null ? '—' : (s.avg_ms / 1000).toFixed(1)}
            <span className="pre">秒</span>
          </dd>
        </div>
        {s.broad !== undefined && (
          <div>
            <dt>擴大搜尋</dt>
            <dd>
              <Link href={href({ since: f.since, flag: 'broad' })}>{s.broad}</Link>
            </dd>
          </div>
        )}
        <div>
          <dt>花費</dt>
          <dd>
            <span className="pre">US$</span>
            {s.cost_usd.toFixed(2)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export default async function AdminAsks({ searchParams }: Props) {
  await requireAdmin();
  const sp = await searchParams;
  const f = parseAskFilter(sp);
  const rawBefore = Array.isArray(sp.before) ? sp.before[0] : sp.before;
  const before = rawBefore && /^\d{1,12}$/.test(rawBefore) ? Number(rawBefore) : null;

  const db = await readDb();
  const today = taipeiDate();
  const weekAgo = new Date(Date.parse(`${today}T00:00:00+08:00`) - 6 * 86_400_000);
  const week = askStats(db, weekAgo);
  const days = askDays(db, 60);
  const { rows, next, total } = listAsks(db, f, before);
  const filtered = Object.keys(f).length > 0;

  return (
    <>
      <h1>問答紀錄</h1>
      <p className="muted">
        聽眾在問答頁問的問題和看到的回答，保留 {ASK_LOG_DAYS} 天，之後只剩每日統計。帳號只顯示從 id 算出的代號，點代號看同一個帳號的問題。
      </p>

      <Totals title="最近 7 天" s={week} f={{ since: taipeiDate(weekAgo) }} />
      {days.some((d) => d.day) && (
        <section className="admin-ask-trend">
          <div>
            <h2>每日題數</h2>
            <div className="admin-spark">
              <Sparkline bars series={days.map((d) => d.day?.asks ?? 0)} label={`最近 ${days.length} 天每日題數`} />
            </div>
          </div>
          <div>
            <h2>每日沒出處比例</h2>
            <div className="admin-spark">
              <Sparkline
                series={days.map(({ day: d }) => (d && d.answered + d.no_source ? d.no_source / (d.answered + d.no_source) : null))}
                label={`最近 ${days.length} 天每日沒出處的比例`}
              />
            </div>
          </div>
          <p className="muted">
            {days[0]!.date} ～ {days.at(-1)!.date}（每晚結算，問答本身刪掉後也留著；沒人問的日子是空的）
          </p>
        </section>
      )}

      <form className="admin-ask-filter" action="/admin/asks">
        <select name="outcome" defaultValue={f.outcome ?? ''} aria-label="結果">
          <option value="">全部結果</option>
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {OUTCOME_LABEL[o]}
            </option>
          ))}
          <option value="failed">失敗（逾時・中斷・錯誤）</option>
        </select>
        <select name="flag" defaultValue={f.flag ?? ''} aria-label="搜尋狀況">
          <option value="">全部搜尋</option>
          {Object.entries(FLAG_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={f.q ?? ''} placeholder="問題或回答裡的字" aria-label="關鍵字" />
        <label>
          從 <input type="date" name="since" defaultValue={f.since ?? ''} />
        </label>
        <label>
          到 <input type="date" name="until" defaultValue={f.until ?? ''} />
        </label>
        {f.of !== undefined && <input type="hidden" name="of" value={f.of} />}
        <button className="btn primary">篩選</button>
        {filtered && (
          <Link className="btn" href="/admin/asks">
            清除
          </Link>
        )}
      </form>

      <p className="muted">
        {f.of !== undefined && <>問第 {f.of} 題的帳號・</>}
        {filtered ? '符合' : '共'} {total} 題
        {before !== null && (
          <>
            ・<Link href={href(f)}>回到最新</Link>
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <p className="muted">{filtered ? '沒有符合的問題。' : `最近 ${ASK_LOG_DAYS} 天還沒有人問過問題。`}</p>
      ) : (
        <ul className="admin-asks">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="admin-ask-meta">
                <span className="mono muted">#{r.id}</span>
                <span className="muted">{taipeiTime(r.createdAt)}</span>
                <Link className="mono" href={href({ of: r.id })} title="這個帳號的問題">
                  {r.user}
                </Link>
                <OutcomePill outcome={r.outcome} />
                {r.flags.map((x) => (
                  <span key={x} className="pill warn">
                    {FLAG_LABEL[x]}
                  </span>
                ))}
                {r.retryOf !== null && (
                  <Link className="pill info" href={`/admin/asks/${r.retryOf}`} title="擴大搜尋的是這一題">
                    擴大搜尋 #{r.retryOf}
                  </Link>
                )}
                {r.broadenedBy !== null && (
                  <Link className="pill warn" href={`/admin/asks/${r.broadenedBy}`} title="聽眾覺得不是他要的，按了擴大搜尋">
                    被擴大搜尋 → #{r.broadenedBy}
                  </Link>
                )}
                <AskFacts cited={r.cited} ms={r.ms} costUsd={r.costUsd} />
              </div>
              <Link className="admin-ask-q" href={`/admin/asks/${r.id}`}>
                {r.question}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {next !== null && (
        <p>
          <Link className="btn" href={href(f, { before: next })}>
            更舊的 ›
          </Link>
        </p>
      )}
    </>
  );
}
