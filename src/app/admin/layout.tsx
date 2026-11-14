import type { Metadata } from 'next';
import Link from 'next/link';
import { countPendingReports } from '@/lib/reports';
import { readDb } from '@/lib/server-db';
import { requireAdmin } from './require-admin';

export const metadata: Metadata = { title: '管理', robots: { index: false, follow: false } };

// Only the accounts in ADMIN_USER_ID get past this; everyone else gets the site's 404. Each
// page checks again (requireAdmin), since a page renders alongside its layout, not after it.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const pending = countPendingReports(await readDb());
  return (
    <div className="admin">
      <nav className="admin-tabs" aria-label="管理">
        <Link href="/admin">逐字稿修正</Link>
        <Link href="/admin/reports">
          錯字回報{pending > 0 && <span className="admin-count">{pending}</span>}
        </Link>
      </nav>
      {children}
    </div>
  );
}
