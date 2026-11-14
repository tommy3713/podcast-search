import { taipeiTime } from '@/components/admin/EditStatus';
import { ReportQueue, type QueueItem } from '@/components/admin/ReportQueue';
import { reportContext, reportEpisode } from '@/lib/admin-reports';
import { episodesWith, hasReportsTable, pendingReports, resolvedReports } from '@/lib/reports';
import { readDb } from '@/lib/server-db';
import { formatTimestamp } from '@/lib/summary';
import { requireAdmin } from '../require-admin';

export default async function AdminReports() {
  await requireAdmin();
  const db = await readDb();
  if (!hasReportsTable(db)) {
    return <p className="muted">這個資料庫還沒有 typo_reports 表：用同一個 DB_PATH 跑一次 npm run worker -- migrate。</p>;
  }
  // Several reports can share an episode or words; each is read once
  const eps = new Map<number, ReturnType<typeof reportEpisode>>();
  const counts = new Map<string, number>();
  const episodes = (words: string) => {
    if (!counts.has(words)) counts.set(words, episodesWith(db, words));
    return counts.get(words)!;
  };
  const items: QueueItem[] = pendingReports(db).map((r) => {
    if (!eps.has(r.episodeNo)) eps.set(r.episodeNo, reportEpisode(db, r.episodeNo));
    const ep = eps.get(r.episodeNo);
    return { report: r, context: ep ? reportContext(ep, r, episodes) : null };
  });
  const done = resolvedReports(db, 30);
  return (
    <>
      <h1>錯字回報</h1>
      <p className="muted">聽眾在集數頁選字回報的錯字。採用後 worker 約 15 秒內套用；同一個錯字的其他回報會一起處理。</p>
      <ReportQueue items={items} />

      <h2>最近處理過的</h2>
      {done.length === 0 ? (
        <p className="muted">還沒有。</p>
      ) : (
        <ul className="admin-log">
          {done.map((r) => (
            <li key={r.id}>
              <span className={r.status === 'accepted' ? 'pill flat' : 'pill warn'}>{r.status === 'accepted' ? '已採用' : '已駁回'}</span>
              <span>
                EP{r.episodeNo} {r.target === 'transcript' ? `逐字稿 ${r.at === null ? '' : formatTimestamp(r.at)}` : '重點'}
              </span>
              <span className="admin-change">
                <del>{r.original}</del>
                <span aria-hidden="true"> → </span>
                <ins>{r.suggestion}</ins>
              </span>
              <span className="muted">{r.resolvedAt && taipeiTime(r.resolvedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
