import { taipeiTime } from '@/components/admin/EditStatus';
import { RuleEditor, RuleToggle } from '@/components/admin/RuleEditor';
import { hasRulesTable, listRules } from '@/lib/rules';
import { readDb } from '@/lib/server-db';
import { CONVERSION_FIXES } from '@/lib/text-fixes';
import { requireAdmin } from '../require-admin';

type Props = { searchParams: Promise<{ id?: string | string[]; original?: string | string[]; replacement?: string | string[] }> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AdminRules({ searchParams }: Props) {
  await requireAdmin();
  const db = await readDb();
  if (!hasRulesTable(db)) {
    return <p className="muted">這個資料庫還沒有 text_fixes 表：用同一個 DB_PATH 跑一次 npm run worker -- migrate。</p>;
  }
  const rules = listRules(db);
  // ?id=: a rule's 編輯; ?original=&replacement=: a typo report's 設成全站規則, which opens the
  // rule for those words when there is one
  const sp = await searchParams;
  const byId = rules.find((r) => String(r.id) === first(sp.id));
  const asked = first(sp.original)?.slice(0, 30) ?? '';
  const existing = byId ?? rules.find((r) => r.original === asked);
  const original = existing?.original ?? asked;
  const replacement = first(sp.replacement)?.slice(0, 30) || existing?.replacement || '';
  return (
    <>
      <h1>錯字規則</h1>
      <p className="muted">
        啟用的規則會套用到之後每一集新轉錄（和重新轉錄）的逐字稿。規則不看前後文，看到錯字就換，所以先看預覽再決定要不要套用到現有的集數；套用到現有集數會變成一般的修改，由
        worker 重新建立索引，每集約 US$0.0005。
      </p>

      <RuleEditor
        key={`${existing?.id ?? 'new'}:${original}→${replacement}`}
        ruleId={existing?.id ?? null}
        initialOriginal={original}
        initialReplacement={replacement}
        initialNote={existing?.note ?? ''}
        initialEnabled={existing?.enabled ?? true}
      />

      <h2>規則（{rules.length}）</h2>
      {rules.length === 0 ? (
        <p className="muted">還沒有規則。</p>
      ) : (
        <ul className="admin-log admin-rules">
          {rules.map((r) => (
            <li key={r.id} className={r.enabled ? undefined : 'off'}>
              <RuleToggle id={r.id} enabled={r.enabled} />
              <span className="admin-change">
                <del>{r.original}</del>
                <span aria-hidden="true"> → </span>
                <ins>{r.replacement}</ins>
              </span>
              {r.note && <span className="muted">{r.note}</span>}
              <span className="muted">{taipeiTime(r.updatedAt)}</span>
              <a href={`/admin/rules?id=${r.id}`}>編輯・套用到現有集數</a>
            </li>
          ))}
        </ul>
      )}

      <h2>程式裡的轉換修正</h2>
      <p className="muted">簡轉繁本身的錯，寫在程式裡（src/lib/text-fixes.ts），每一集都會套用，這裡不能改。</p>
      <ul className="admin-log">
        {CONVERSION_FIXES.map(([from, to, why]) => (
          <li key={from}>
            <span className="admin-change">
              <del>{from}</del>
              <span aria-hidden="true"> → </span>
              <ins>{to}</ins>
            </span>
            <span className="muted">{why}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
