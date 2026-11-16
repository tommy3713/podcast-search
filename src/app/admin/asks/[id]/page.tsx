import Link from 'next/link';
import { AskAnswer, AskSources } from '@/components/admin/AskAnswer';
import { AskFacts, OutcomePill } from '@/components/admin/AskParts';
import { taipeiTime } from '@/components/admin/EditStatus';
import { getAsk, goldenDraft, NOTE_LABEL, type SearchStep } from '@/lib/ask/log';
import { ASK_LOG_DAYS } from '@/lib/ask/quota';
import { readDb } from '@/lib/server-db';
import { requireAdmin } from '../../require-admin';

type Props = { params: Promise<{ id: string }> };

const TOOL_LABEL: Record<SearchStep['tool'], string> = { transcript: '逐字稿', mentions: '提及', other: '其他' };
const terms = (ts: string[]) => ts.map((t) => `「${t}」`).join('');

export default async function AdminAsk({ params }: Props) {
  await requireAdmin();
  const raw = (await params).id;
  const id = /^\d{1,12}$/.test(raw) ? Number(raw) : null;
  const a = id === null ? null : getAsk(await readDb(), id);
  if (!a) {
    return (
      <>
        <h1>問答 #{raw}</h1>
        <p className="muted">
          找不到這一題（紀錄保留 {ASK_LOG_DAYS} 天）。<Link href="/admin/asks">回問答紀錄</Link>
        </p>
      </>
    );
  }
  const golden = goldenDraft(a);
  const tokens = a.inputTokens !== null || a.outputTokens !== null ? `輸入 ${a.inputTokens ?? 0}・輸出 ${a.outputTokens ?? 0} tokens` : null;
  return (
    <>
      <nav className="admin-ask-nav">
        <Link href="/admin/asks">‹ 問答紀錄</Link>
        <span>
          {a.newer !== null && <Link href={`/admin/asks/${a.newer}`}>較新</Link>}
          {a.older !== null && <Link href={`/admin/asks/${a.older}`}>較舊</Link>}
        </span>
      </nav>
      <h1>問答 #{a.id}</h1>
      <div className="admin-ask-meta">
        <span className="muted">{taipeiTime(a.createdAt)}</span>
        <Link className="mono" href={`/admin/asks?of=${a.id}`} title="這個帳號的問題">
          {a.user}
        </Link>
        <OutcomePill outcome={a.outcome} />
        <AskFacts cited={a.cited} ms={a.ms} costUsd={a.costUsd} />
        {a.hits !== null && <span className="muted">搜到 {a.hits} 筆</span>}
        {tokens && <span className="muted">{tokens}</span>}
      </div>

      <article className="msg admin-ask-body">
        <h2 className="q">{a.question}</h2>
        {a.answer ? (
          <div className="card ans">
            <AskAnswer text={a.answer} sources={a.sources} />
          </div>
        ) : (
          <p className="muted">（沒有回答）</p>
        )}
      </article>

      {a.sources ? (
        <>
          <h2>引用的段落</h2>
          <p className="muted">回答引用的出處，依第一次引用的順序，是模型讀到的完整段落。點 EP 開在那個時間。</p>
          <AskSources sources={a.sources} />
          {a.sourcesBroken && <p className="muted">有些出處資料讀不出來，沒有列出。</p>}
        </>
      ) : (
        (a.sourcesBroken || !!a.cited) && (
          <p className="muted">
            {a.sourcesBroken ? '這題的出處資料讀不出來' : '這題記錄時還沒有保存出處（或這份資料庫沒有這個欄位）'}，[n] 只能看編號。
          </p>
        )
      )}

      <h2>搜尋過程</h2>
      {a.steps.length === 0 ? (
        <p className="muted">沒有呼叫搜尋。</p>
      ) : (
        <ol className="admin-ask-steps">
          {a.steps.map((s, i) => (
            <li key={i}>
              <span className="pill flat">{TOOL_LABEL[s.tool]}</span>
              <span className="admin-ask-what">{s.what}</span>
              <span className="muted">{s.results} 筆</span>
              {s.cut.length > 0 && <span className="pill warn">{terms(s.cut)}{NOTE_LABEL.cut}</span>}
              {s.unmatched && <span className="pill warn">{NOTE_LABEL.unmatched}</span>}
              {s.sound.length > 0 && <span className="pill info">{terms(s.sound)}{NOTE_LABEL.sound}</span>}
            </li>
          ))}
        </ol>
      )}

      <h2>接著做</h2>
      <p className="admin-ask-actions">
        <Link className="btn" href={`/ask?q=${encodeURIComponent(a.question)}`} target="_blank">
          在問答頁重問
        </Link>
        <Link className="btn" href={`/admin/asks?of=${a.id}`}>
          這個帳號的其他問題
        </Link>
      </p>
      {golden ? (
        <details className="card admin-history">
          <summary>做成 golden 題目</summary>
          <p className="muted">
            貼進 evals/golden.jsonl 前，把問題改寫成你自己的說法（聽眾的原文只保留 {ASK_LOG_DAYS} 天，不進 repo），填 points，改 id，照
            evals/README.md 的規則檢查 expect_eps。
            {golden.partial && ' 有一行引用超過 3 集，標籤只列出前 3 集：expect_eps 不完整，重問一次看完整出處。'}
          </p>
          <pre className="admin-golden">{golden.line}</pre>
        </details>
      ) : (
        <p className="muted">這題沒有完成回答，不適合直接做成 golden 題目。</p>
      )}
    </>
  );
}
