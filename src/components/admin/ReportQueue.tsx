'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReportContext } from '@/lib/admin-reports';
import type { AdminReport } from '@/lib/reports';
import { formatTimestamp } from '@/lib/summary';
import { taipeiTime } from './EditStatus';

export type QueueItem = { report: AdminReport; context: ReportContext | null };

export function ReportQueue({ items }: { items: QueueItem[] }) {
  if (!items.length) return <p className="muted">沒有待處理的回報。</p>;
  return (
    <ul className="admin-reports">
      {items.map((it) => (
        <ReportCard key={it.report.id} item={it} />
      ))}
    </ul>
  );
}

type Action = 'here' | 'episode' | 'summary' | 'reject';

function ReportCard({ item: { report: r, context: c } }: { item: QueueItem }) {
  const router = useRouter();
  const [suggestion, setSuggestion] = useState(r.suggestion);
  const [also, setAlso] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const transcript = r.target === 'transcript';
  const at = r.at === null ? null : Math.floor(r.at);

  const act = async (action: Action) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/admin/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: r.id,
          action,
          suggestion,
          alsoSummary: transcript && also,
          alsoTranscript: !transcript && also,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setNote(res.ok ? { ok: true, text: data.message ?? '完成' } : { ok: false, text: data.error ?? `失敗（${res.status}）` });
      if (res.ok) router.refresh();
    } catch {
      setNote({ ok: false, text: '連線失敗，請再試一次。' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="card admin-report">
      <div className="admin-report-head">
        <span className="pill info">{transcript ? '逐字稿' : '重點'}</span>
        <Link href={transcript && at !== null ? `/ep/${r.episodeNo}?t=${at}` : `/ep/${r.episodeNo}`} target="_blank">
          EP{r.episodeNo}
          {transcript && r.at !== null && ` ${formatTimestamp(r.at)}`}
        </Link>
        {transcript && at !== null && <Link href={`/admin/ep/${r.episodeNo}#t-${at}`}>到逐字稿編輯</Link>}
        {r.same > 0 && <span className="pill warn">另有 {r.same} 人回報同樣的</span>}
        <span className="muted">{taipeiTime(r.createdAt)}</span>
      </div>

      <div className="admin-report-change">
        <del>{r.original}</del>
        <span aria-hidden="true">→</span>
        <input value={suggestion} onChange={(e) => setSuggestion(e.target.value)} aria-label="改成" />
      </div>
      {r.note && <p className="admin-report-note">備註：{r.note}</p>}

      {!c ? (
        <>
          <p className="muted">這集目前不在網站上，只能駁回；回到網站上之後就能採用。</p>
          <div className="admin-report-actions">
            <button className="btn ghost" disabled={busy} onClick={() => act('reject')}>
              駁回
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="admin-report-facts muted">
            {c.sameSound && <span className="pill flat">讀音相同</span>}
            <span>這集逐字稿 {c.transcriptCount} 處</span>
            <span>重點 {c.summaryCount} 處</span>
            <span>全站 {c.episodes} 集的逐字稿有這段原文</span>
          </p>
          {transcript && c.here && (
            <blockquote className="admin-report-context">
              <Mark text={c.here.text} term={r.original} />
            </blockquote>
          )}
          {transcript && !c.here && <p className="admin-error">這一段找不到原文（可能跨了兩句，或已經改過），要改請用逐字稿編輯。</p>}
          {!transcript &&
            c.summaryLines.map((t, i) => (
              <blockquote key={i} className="admin-report-context">
                <Mark text={t} term={r.original} />
              </blockquote>
            ))}

          <div className="admin-report-actions">
            {transcript ? (
              <>
                <button className="btn primary" disabled={busy || !c.here} onClick={() => act('here')}>
                  只改這處
                </button>
                <button className="btn" disabled={busy || !c.transcriptCount} onClick={() => act('episode')}>
                  這集全部（{c.transcriptSegments} 句）
                </button>
                {c.summaryCount > 0 && (
                  <label>
                    <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} /> 重點也改（{c.summaryCount} 處）
                  </label>
                )}
              </>
            ) : (
              <>
                <button className="btn primary" disabled={busy || !c.summaryCount} onClick={() => act('summary')}>
                  改這集重點（{c.summaryCount} 處）
                </button>
                {c.transcriptCount > 0 && (
                  <label>
                    <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} /> 逐字稿也改（{c.transcriptSegments} 句）
                  </label>
                )}
              </>
            )}
            <button className="btn ghost" disabled={busy} onClick={() => act('reject')}>
              駁回
            </button>
          </div>
        </>
      )}
      {note && <p className={note.ok ? 'muted' : 'admin-error'}>{note.text}</p>}
    </li>
  );
}

function Mark({ text, term }: { text: string; term: string }) {
  const i = text.indexOf(term);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{term}</mark>
      {text.slice(i + term.length)}
    </>
  );
}
