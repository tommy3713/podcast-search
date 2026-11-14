import Link from 'next/link';
import { taipeiTime } from '@/components/admin/EditStatus';
import { WhisperEditor } from '@/components/admin/WhisperEditor';
import { readDb } from '@/lib/server-db';
import { hasPromptsTable, promptVersions } from '@/lib/whisper/prompts';
import { WHISPER_PROMPT_TOKENS, whisperTokens } from '@/lib/whisper/tokens';
import { requireAdmin } from '../require-admin';

type Props = { searchParams: Promise<{ add?: string | string[]; restore?: string | string[] }> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AdminWhisper({ searchParams }: Props) {
  await requireAdmin();
  const db = await readDb();
  if (!hasPromptsTable(db)) {
    return <p className="muted">這個資料庫還沒有 whisper_prompts 表：用同一個 DB_PATH 跑一次 npm run worker -- migrate。</p>;
  }
  const versions = promptVersions(db).map((v) => ({ ...v, tokens: whisperTokens(v.text) }));
  const current = versions.find((v) => v.current)!;
  const sp = await searchParams;
  // From a typo report's 加進提示詞: a word to place, not text to append blindly
  const add = first(sp.add)?.trim().slice(0, 30) || null;
  // 用這版編輯 on an older version: its text in the editor, saved as a new version if wanted
  const restore = first(sp.restore);
  const from = versions.find((v) => (restore === 'built-in' ? v.id === null : String(v.id) === restore));
  return (
    <>
      <h1>Whisper 提示詞</h1>
      <p className="muted">
        Whisper 轉錄時會參考這段文字的用字和寫法，常聽錯的專有名詞寫在這裡可以減少錯字。只影響之後轉錄（或重新轉錄）的集數。最多{' '}
        {WHISPER_PROMPT_TOKENS} 個 token，超過的話 Whisper 會直接丟掉開頭。寫成像主持人在講話的句子效果比較好；詞塞太多，Whisper
        有時會在安靜的段落把提示詞裡的詞「聽」出來。
      </p>
      <WhisperEditor
        // A new key when the starting text changes, so the editor starts over with it
        key={`${current.id ?? 'built-in'}:${from ? (from.id ?? 'built-in') : ''}`}
        current={current.text}
        initial={from?.text ?? current.text}
        add={add}
        limit={WHISPER_PROMPT_TOKENS}
      />

      <h2>歷史版本</h2>
      <ul className="admin-versions">
        {versions.map((v) => (
          <li key={v.id ?? 'built-in'} className="card">
            <div className="admin-report-head">
              {v.current && <span className="pill info">使用中</span>}
              <span>{v.id === null ? '內建' : `第 ${v.id} 版`}</span>
              {v.createdAt && <span className="muted">{taipeiTime(v.createdAt)}</span>}
              <span className="muted">{v.tokens} token</span>
              <span className="muted">
                {v.episodes} 集用這版轉錄{v.id === null ? '（含記錄之前的集數）' : ''}
              </span>
              {!v.current && <Link href={`/admin/whisper?restore=${v.id ?? 'built-in'}`}>用這版編輯</Link>}
            </div>
            <p>{v.text}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
