import type { EditRow } from '@/lib/admin-edits';
import { editDiff } from '@/lib/transcript-edits';

const LABEL = { pending: '待套用', applied: '已套用', failed: '失敗' } as const;
const PILL = { pending: 'pill info', applied: 'pill flat', failed: 'pill warn' } as const;

export function EditStatus({ edit }: { edit: EditRow }) {
  return (
    <span className={PILL[edit.status]} title={edit.error ?? undefined}>
      {LABEL[edit.status]}
    </span>
  );
}

// What an edit changed, with a little context: 「交言肥腸」→「椒鹽肥腸」
export function EditChange({ edit }: { edit: EditRow }) {
  const { wrong, right } = editDiff(edit.oldText, edit.newText);
  return (
    <span className="admin-change">
      <del>{wrong || '（空白）'}</del>
      <span aria-hidden="true"> → </span>
      <ins>{right || '（刪除）'}</ins>
    </span>
  );
}

// Taipei time, the same on the server and in the browser (no locale formatting)
export function taipeiTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + 8 * 3600_000).toISOString().slice(5, 16).replace('T', ' ');
}
