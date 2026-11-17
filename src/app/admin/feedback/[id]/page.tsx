import Link from 'next/link';
import { notFound } from 'next/navigation';
import { taipeiTime } from '@/components/admin/EditStatus';
import { FeedbackActions } from '@/components/admin/FeedbackActions';
import { userTag } from '@/lib/ask/log';
import { getFeedback, gmailReplyUrl, hasFeedbackTable, isSitePath, KIND_ICON, KIND_LABEL, otherFeedback, STATUS_LABEL, STATUS_PILL } from '@/lib/feedback';
import { readDb } from '@/lib/server-db';
import { requireAdmin } from '../../require-admin';

type Props = { params: Promise<{ id: string }> };

export default async function AdminFeedbackItem({ params }: Props) {
  await requireAdmin();
  const { id } = await params;
  const db = await readDb();
  if (!/^\d+$/.test(id) || !hasFeedbackTable(db)) notFound();
  const f = getFeedback(db, Number(id));
  if (!f) notFound();
  const reply = gmailReplyUrl(f);
  const others = otherFeedback(db, f);
  return (
    <>
      <p className="admin-small">
        <Link href="/admin/feedback">← 意見回饋</Link>
      </p>
      <h1>
        #{f.id} {KIND_ICON[f.kind]} {KIND_LABEL[f.kind]}
      </h1>
      <section className="card admin-feedback-detail">
        <p className="admin-feedback-body">{f.body}</p>
        <dl>
          <dt>狀態</dt>
          <dd>
            <span className={STATUS_PILL[f.status]}>{STATUS_LABEL[f.status]}</span>
            {f.resolvedAt && <span className="muted">　{taipeiTime(f.resolvedAt)}</span>}
          </dd>
          <dt>送出</dt>
          <dd>{taipeiTime(f.createdAt)}</dd>
          <dt>頁面</dt>
          <dd>
            {f.page && isSitePath(f.page) ? (
              <Link className="mono" href={f.page} prefetch={false}>
                {f.page}
              </Link>
            ) : (
              '—'
            )}
          </dd>
          <dt>Email</dt>
          <dd>{f.email ? <span className="mono">{f.email}</span> : <span className="muted">沒有留，不會收到回覆</span>}</dd>
          <dt>帳號</dt>
          <dd>{f.userId ? <span className="mono">{userTag(f.userId)}</span> : <span className="muted">已清除</span>}</dd>
          {f.client && (
            <>
              <dt>瀏覽器</dt>
              <dd>
                <span className="mono">{f.client.ua}</span>
                <br />
                {f.client.width}×{f.client.height}・{f.client.theme === 'dark' ? '深色' : '淺色'}
              </dd>
            </>
          )}
        </dl>
        {reply && (
          <p className="admin-report-actions">
            <a className="btn primary" href={reply} target="_blank" rel="noopener noreferrer">
              用 Gmail 回覆
            </a>
            <span className="muted">回覆後把狀態改成「已回覆」</span>
          </p>
        )}
        <FeedbackActions id={f.id} status={f.status} note={f.note} />
      </section>

      {others.length > 0 && (
        <>
          <h2>這個帳號的其他回饋</h2>
          <ul className="admin-feedback">
            {others.map((o) => (
              <li key={o.id}>
                <Link className="card" href={`/admin/feedback/${o.id}`} prefetch={false}>
                  <span className="admin-feedback-head">
                    <span className={STATUS_PILL[o.status]}>{STATUS_LABEL[o.status]}</span>
                    <span>
                      #{o.id} {KIND_ICON[o.kind]} {KIND_LABEL[o.kind]}
                    </span>
                    <span className="muted">{taipeiTime(o.createdAt)}</span>
                  </span>
                  <p className="admin-feedback-preview">{o.body}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
