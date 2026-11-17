import type { Metadata } from 'next';
import Link from 'next/link';
import { countNewFeedback } from '@/lib/feedback';
import { countPendingReports } from '@/lib/reports';
import { readDb } from '@/lib/server-db';
import { requireAdmin } from './require-admin';

export const metadata: Metadata = { title: '管理', robots: { index: false, follow: false } };

// Only the accounts in ADMIN_USER_ID get past this; everyone else gets the site's 404. Each
// page checks again (requireAdmin), since a page renders alongside its layout, not after it.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const db = await readDb();
  const pending = countPendingReports(db);
  const feedback = countNewFeedback(db);
  return (
    <div className="admin">
      <nav className="admin-tabs" aria-label="管理">
        <Link href="/admin">逐字稿修正</Link>
        <Link href="/admin/reports">
          錯字回報{pending > 0 && <span className="admin-count">{pending}</span>}
        </Link>
        <Link href="/admin/feedback">
          意見回饋{feedback > 0 && <span className="admin-count">{feedback}</span>}
        </Link>
        <Link href="/admin/rules">錯字規則</Link>
        <Link href="/admin/whisper">Whisper 提示詞</Link>
        <Link href="/admin/asks">問答紀錄</Link>
      </nav>
      {children}
    </div>
  );
}
