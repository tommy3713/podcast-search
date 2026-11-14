import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TranscriptEditor } from '@/components/admin/TranscriptEditor';
import { adminEpisode, hasEditsTable } from '@/lib/admin-edits';
import { parseEpisodeNo } from '@/lib/episodes';
import { readDb } from '@/lib/server-db';
import { requireAdmin } from '../../require-admin';

type Props = { params: Promise<{ no: string }> };

export default async function AdminEpisodePage({ params }: Props) {
  await requireAdmin();
  const no = parseEpisodeNo((await params).no);
  const db = await readDb();
  if (no === null) notFound();
  if (!hasEditsTable(db)) {
    return <p className="muted">這個資料庫還沒有 transcript_edits 表：用同一個 DB_PATH 跑一次 npm run worker -- migrate。</p>;
  }
  const ep = adminEpisode(db, no);
  if (!ep) notFound();
  return (
    <>
      <h1>
        EP{ep.no} 逐字稿 <span className="muted admin-title">{ep.title}</span>
      </h1>
      <p className="muted">
        點一句就能改，改好幾句再一起送出；時間戳不能改。送出後 worker 約 15 秒內套用並重新建立搜尋索引，摘要不會變。
        <Link href={`/ep/${ep.no}?tab=tx`} target="_blank">
          看公開頁面
        </Link>
      </p>
      <TranscriptEditor episode={ep.no} segments={ep.segments} edits={ep.edits} />
    </>
  );
}
