import Link from 'next/link';
import { taipeiTime } from '@/components/admin/EditStatus';
import { userTag } from '@/lib/ask/log';
import {
  FEEDBACK_KEEP_DAYS,
  FEEDBACK_KINDS,
  FEEDBACK_PAGE,
  FEEDBACK_STATUSES,
  type FeedbackFilter,
  hasFeedbackTable,
  KIND_ICON,
  KIND_LABEL,
  listFeedback,
  STATUS_LABEL,
  STATUS_PILL,
} from '@/lib/feedback';
import { readDb } from '@/lib/server-db';
import { requireAdmin } from '../require-admin';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

function parseFilter(q: Record<string, string | string[] | undefined>): FeedbackFilter {
  const status = one(q.status);
  const kind = one(q.kind);
  return {
    status: FEEDBACK_STATUSES.find((s) => s === status),
    kind: FEEDBACK_KINDS.find((k) => k === kind),
  };
}

export default async function AdminFeedback({ searchParams }: Props) {
  await requireAdmin();
  const db = await readDb();
  if (!hasFeedbackTable(db)) {
    return <p className="muted">這個資料庫還沒有 feedback 表：用同一個 DB_PATH 跑一次 npm run worker -- migrate。</p>;
  }
  const q = await searchParams;
  const filter = parseFilter(q);
  const page = Math.max(1, Math.floor(Number(one(q.page)) || 1));
  const { items, more } = listFeedback(db, filter, FEEDBACK_PAGE, (page - 1) * FEEDBACK_PAGE);
  // This list's query string on another page (the filter kept)
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    if (filter.status) p.set('status', filter.status);
    if (filter.kind) p.set('kind', filter.kind);
    if (n > 1) p.set('page', String(n));
    const s = p.toString();
    return s ? `/admin/feedback?${s}` : '/admin/feedback';
  };
  return (
    <>
      <h1>意見回饋</h1>
      <p className="muted">
        聽眾從 header 的 💬 送來的問題回報、功能許願和其他意見。網站不寄信：有留 email 的，在詳細頁按「用 Gmail 回覆」；email 和帳號識別碼保存{' '}
        {FEEDBACK_KEEP_DAYS} 天。
      </p>
      <form className="admin-feedback-filter" method="get">
        <label>
          狀態{' '}
          <select name="status" defaultValue={filter.status ?? ''}>
            <option value="">全部</option>
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          類型{' '}
          <select name="kind" defaultValue={filter.kind ?? ''}>
            <option value="">全部</option>
            {FEEDBACK_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn ghost">篩選</button>
        {(filter.status || filter.kind) && <Link href="/admin/feedback">清除</Link>}
      </form>
      {items.length === 0 ? (
        <p className="muted">沒有符合的回饋。</p>
      ) : (
        <ul className="admin-feedback">
          {items.map((f) => (
            <li key={f.id}>
              <Link className="card" href={`/admin/feedback/${f.id}`} prefetch={false}>
                <span className="admin-feedback-head">
                  <span className={STATUS_PILL[f.status]}>{STATUS_LABEL[f.status]}</span>
                  <span>
                    #{f.id} {KIND_ICON[f.kind]} {KIND_LABEL[f.kind]}
                  </span>
                  {f.email && <span title="有留 email">📧</span>}
                  {f.page && <span className="mono muted">{f.page}</span>}
                  {f.userId && <span className="mono muted">{userTag(f.userId)}</span>}
                  <span className="muted">{taipeiTime(f.createdAt)}</span>
                </span>
                <p className="admin-feedback-preview">{f.body}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(page > 1 || more) && (
        <p className="admin-report-more">
          {page > 1 && <Link href={pageHref(page - 1)}>← 上一頁</Link>}
          <span className="muted">第 {page} 頁</span>
          {more && <Link href={pageHref(page + 1)}>下一頁 →</Link>}
        </p>
      )}
    </>
  );
}
