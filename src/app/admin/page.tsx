import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EditChange, EditStatus, taipeiTime } from '@/components/admin/EditStatus';
import { formatTimestamp } from '@/lib/summary';
import { hasEditsTable, recentEdits } from '@/lib/admin-edits';
import { parseEpisodeNo } from '@/lib/episodes';
import { readDb } from '@/lib/server-db';
import { requireAdmin } from './require-admin';

type Props = { searchParams: Promise<{ ep?: string | string[] }> };

export default async function AdminHome({ searchParams }: Props) {
  await requireAdmin();
  // The form below is a plain GET, so it works before any JavaScript loads
  // A repeated ?ep= arrives as an array; the first one counts
  const raw = (await searchParams).ep;
  const ep = Array.isArray(raw) ? raw[0] : raw;
  const no = ep === undefined ? null : parseEpisodeNo(ep.trim().replace(/^ep/i, ''));
  if (no !== null) redirect(`/admin/ep/${no}`);

  const db = await readDb();
  const ready = hasEditsTable(db);
  const edits = ready ? recentEdits(db, 50) : [];
  return (
    <>
      <h1>逐字稿修正</h1>
      <form className="field admin-open" action="/admin">
        <input name="ep" inputMode="numeric" placeholder="集數，例如 709" aria-label="集數" defaultValue={ep ?? ''} required />
        <button className="btn primary">打開</button>
      </form>
      {ep !== undefined && no === null && <p className="muted">「{ep}」不是集數。</p>}
      {!ready && <p className="muted">這個資料庫還沒有 transcript_edits 表：用同一個 DB_PATH 跑一次 npm run worker -- migrate。</p>}

      <h2>最近的修改</h2>
      {edits.length === 0 ? (
        <p className="muted">還沒有修改。</p>
      ) : (
        <ul className="admin-log">
          {edits.map((e) => (
            <li key={e.id}>
              <EditStatus edit={e} />
              <Link href={`/admin/ep/${e.episodeNo}#t-${Math.floor(e.segStart)}`}>
                EP{e.episodeNo} {formatTimestamp(e.segStart)}
              </Link>
              <EditChange edit={e} />
              <span className="muted">{taipeiTime(e.createdAt)}</span>
              {e.error && <span className="muted">{e.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
