'use client';

import Link from 'next/link';
import { Fragment, memo, useCallback, useEffect, useRef, useState } from 'react';
import type { AskEvent, Source } from '@/lib/ask/agent';
import { citedOrder, episodeLabel, groupBlocks, labelBlocks, type LabeledBlock, OTHER_SOURCES_SHOWN, otherSources, parseAnswer, splitEvents } from '@/lib/ask/render';
import { previewParts, type SourceFocus, sourceFocus, sourceHref, termFocus } from '@/lib/ask/focus';
import { formatTimestamp } from '@/lib/summary';

type Msg = {
  id: string;
  q: string;
  status: string | null;
  sources: Record<number, Source>;
  text: string;
  done: boolean;
  error: string | null;
  logId?: number; // its ask_log id, which 擴大搜尋 sends back (absent on answers kept from before)
  broadOf?: string; // 擴大搜尋: the message it broadened
  broadened?: boolean; // 擴大搜尋 was asked for this one
};

type Props = { episodeCount: number; initialQuota: number; dailyLimit: number; logDays: number; examples: string[]; initialQuestion: string };

// Keeps answers when you open a cited episode and come back; per tab, never sent anywhere
const STORAGE_KEY = 'gooaye.ask.v1';
const MAX_KEPT = 20;

function load(): Msg[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Msg[]).filter((m) => m.done || m.error) : [];
  } catch {
    return [];
  }
}

function save(msgs: Msg[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-MAX_KEPT)));
  } catch {
    // storage full or blocked: answers just won't survive navigation
  }
}

export function AskView({ episodeCount, initialQuota, dailyLimit, logDays, examples, initialQuestion }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [quota, setQuota] = useState(initialQuota);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(initialQuestion);
  const loaded = useRef(false);

  useEffect(() => {
    setMsgs(load());
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (loaded.current && !busy) save(msgs);
  }, [msgs, busy]);

  const update = (id: string, f: (m: Msg) => Msg) => setMsgs((all) => all.map((m) => (m.id === id ? f(m) : m)));

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || quota <= 0) return;
    setQ('');
    // A question that came in ?q= is asked now: left in the URL, a reload would fill it in again
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    await run({ q: text }, { question: text });
  }

  // 擴大搜尋: the same question once more, broader, as a new answer below; free, so not
  // stopped by a used-up quota. Given back to try again unless the server says it was used.
  async function broaden(of: Msg) {
    if (busy || !of.logId || of.broadOf || of.broadened) return;
    update(of.id, (m) => ({ ...m, broadened: true }));
    const status = await run({ q: of.q, broadOf: of.id }, { retryOf: of.logId });
    if (status !== null && status !== 409) update(of.id, (m) => ({ ...m, broadened: false }));
  }

  // Sends one request and streams its answer into a new message. Returns null when it
  // answered, else the status it was refused with (0 for a dropped connection, -1 for an
  // error the stream reported: the server gives a broadening back when nothing was answered).
  async function run(msg: Pick<Msg, 'q' | 'broadOf'>, body: { question: string } | { retryOf: number }): Promise<number | null> {
    const id = `${Date.now()}`;
    setMsgs((all) => [...all, { id, ...msg, status: null, sources: {}, text: '', done: false, error: null }]);
    setBusy(true);
    requestAnimationFrame(() => document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        // A broadened question is free: a full site is the only 429 it gets, and that isn't the user's quota
        if (res.status === 429 && 'question' in body) setQuota(0);
        update(id, (m) => ({ ...m, error: err.error ?? '發生錯誤，請稍後再試。', done: true }));
        return res.status;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      let failed = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const { events, rest } = splitEvents(buf + value);
        buf = rest;
        for (const raw of events) {
          const e = JSON.parse(raw) as AskEvent;
          if (e.type === 'error') failed = true;
          apply(id, e);
        }
      }
      update(id, (m) => ({ ...m, done: true }));
      return failed ? -1 : null;
    } catch {
      update(id, (m) => ({ ...m, error: m.error ?? '連線中斷，請再試一次。', done: true }));
      return 0;
    } finally {
      setBusy(false);
    }
  }

  // Stable for the memoized messages, while calling the latest broaden (it reads busy)
  const broadenRef = useRef(broaden);
  broadenRef.current = broaden;
  const onBroaden = useCallback((m: Msg) => broadenRef.current(m), []);

  function apply(id: string, e: AskEvent) {
    switch (e.type) {
      case 'quota':
        return setQuota(e.remaining);
      case 'status':
        return update(id, (m) => ({ ...m, status: e.text }));
      case 'sources':
        return update(id, (m) => ({ ...m, sources: { ...m.sources, ...Object.fromEntries(e.sources.map((s) => [s.n, s])) } }));
      case 'delta':
        return update(id, (m) => ({ ...m, text: m.text + e.text }));
      case 'reset':
        return update(id, (m) => ({ ...m, text: '' }));
      case 'done':
        return update(id, (m) => ({ ...m, done: true }));
      case 'error':
        return update(id, (m) => ({ ...m, error: e.message, done: true }));
      case 'logged':
        return update(id, (m) => ({ ...m, logId: e.id }));
    }
  }

  const out = quota <= 0;
  return (
    <div className="ask">
      <div className="ask-head">
        <div>
          <h1>問所有集數</h1>
          <div className="fine">目前收錄 {episodeCount} 集，回答會附上集數和時間點</div>
        </div>
        <span className={`pill ${out ? 'warn' : 'info'}`}>今天剩 {quota} 次</span>
      </div>

      {msgs.length === 0 && (
        <div className="card" style={{ padding: 18, display: 'grid', gap: 10 }}>
          <div className="eyebrow">可以這樣問</div>
          <div className="examples">
            {examples.map((x) => (
              <button key={x} type="button" onClick={() => ask(x)} disabled={busy || out}>
                {x}
              </button>
            ))}
          </div>
          {/* Here rather than in the sticky composer: seen before the first question, without
              taking screen space for good (and it comes and goes with the examples) */}
          <p className="fine" style={{ margin: 0 }}>
            找某一集時，寫你記得的原話、人名或英文最好找；不確定是什麼時候，就不要寫時間。
          </p>
          <p className="fine" style={{ margin: 0 }}>
            問題會傳給 OpenAI 產生回答，問答會連同帳號保存 {logDays} 天後自動刪除。<Link href="/about#privacy">隱私說明</Link>
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gap: 28 }}>
        {msgs.map((m) => (
          <Message key={m.id} m={m} busy={busy} onBroaden={onBroaden} />
        ))}
      </div>

      <form
        className="card composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        {out && <div className="notice warn">今天的 {dailyLimit} 次用完了，明天 00:00 重置。</div>}
        <div className="field">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // IME composition (注音、倉頡) uses Enter to pick characters
              if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
            }}
            maxLength={300}
            placeholder={out ? '明天再來問' : '問任何跟節目內容有關的問題'}
            aria-label="問題"
            autoComplete="off"
            disabled={out}
          />
          <button className="btn primary" type="submit" disabled={out || busy || !q.trim()}>
            {busy ? '回答中…' : '送出'}
          </button>
        </div>
      </form>
    </div>
  );
}

// Memoized: a streamed answer re-renders the list, and the finished ones above it haven't changed
const Message = memo(function Message({ m, busy, onBroaden }: { m: Msg; busy: boolean; onBroaden: (m: Msg) => void }) {
  const epOf = new Map(Object.values(m.sources).map((s) => [s.n, s.ep]));
  const known = new Set(epOf.keys());
  const blocks = labelBlocks(parseAnswer(m.text, known, !m.done), epOf, !m.done);
  const citedNs = citedOrder(blocks);
  const cited = citedNs
    .map((n) => m.sources[n])
    .filter((s): s is Source => !!s);
  const found = Object.keys(m.sources).length;
  // Where in each cited passage the answer's words are: the card shows them, the link opens there
  const focus = sourceFocus(blocks, m.sources);

  return (
    <article className="msg" id={`msg-${m.id}`}>
      {m.broadOf && <span className="pill info broad-tag">擴大搜尋</span>}
      <h2 className="q">{m.q}</h2>
      {!m.done && !m.text && (
        <div className="status" role="status">
          {m.status ?? '思考中…'}
          {found > 0 && `・找到 ${found} 個相關片段`}
        </div>
      )}
      {cited.length > 0 && (
        <div className="srcs">
          {cited.map((s) => (
            <Link key={s.n} className="src" href={sourceHref(s, focus.get(s.n))}>
              <span className="h">
                <span className="n">{s.n}</span>EP{s.ep}
                <span className="mono muted" style={{ fontWeight: 400 }}>
                  {formatTimestamp(s.t)}
                </span>
              </span>
              <Preview s={s} f={focus.get(s.n)} />
            </Link>
          ))}
        </div>
      )}
      {(m.text || m.done) && !(m.error && !m.text) && (
        <div className="card ans">
          <AnswerBlocks blocks={blocks} sources={m.sources} focus={focus} />
          {!m.done && <span className="caret" />}
        </div>
      )}
      {m.error && <div className="notice warn">{m.error}</div>}
      {m.done && !m.error && (
        <p className="fine" style={{ margin: 0 }}>
          AI 根據逐字稿產生，可能有誤，請點出處核對原節目；不是投資建議。
        </p>
      )}
      {m.done && !m.error && (
        <NotWhatYouWanted
          others={otherSources(m.sources, citedNs)}
          // Once per question, and not on a broad answer itself; answers kept from before have no id
          broaden={m.logId && !m.broadOf ? { done: !!m.broadened, busy, go: () => onBroaden(m) } : null}
        />
      )}
    </article>
  );
});

// Below every finished answer: what the searches found that the answer left out, and how
// to ask so the next search finds more. Closed until opened, even when the answer cites
// nothing: then the passages are often ones found only by meaning, about something else
// (asked about Rivian, EP706's Tesla Roadster), which the answer rightly didn't switch to.
function NotWhatYouWanted({ others, broaden }: { others: Source[]; broaden: { done: boolean; busy: boolean; go: () => void } | null }) {
  const [all, setAll] = useState(false);
  const shown = all ? others : others.slice(0, OTHER_SOURCES_SHOWN);
  return (
    <details className="ask-more">
      <summary>不是你要找的？</summary>
      <div className="ask-more-body">
        {broaden && (
          <div className="broaden">
            <button type="button" className="btn primary" onClick={broaden.go} disabled={broaden.done || broaden.busy}>
              {broaden.done ? '已擴大搜尋' : '擴大搜尋'}
            </button>
            <span className="fine">不限日期、換別的說法再找一次，不扣今天的次數。每題一次。</span>
          </div>
        )}
        {others.length > 0 && (
          <>
            <div className="eyebrow">搜尋也找到這 {others.length} 段，回答沒有用到</div>
            <div className="more-srcs">
              {shown.map((s) => {
                const f = termFocus(s);
                return (
                  <Link key={s.n} className="src" href={sourceHref(s, f)}>
                    <span className="h">
                      EP{s.ep}
                      <span className="mono muted" style={{ fontWeight: 400 }}>
                        {formatTimestamp(s.t)}
                      </span>
                    </span>
                    <Preview s={s} f={f} />
                  </Link>
                );
              })}
            </div>
            {shown.length < others.length && (
              <button type="button" className="btn more-all" onClick={() => setAll(true)}>
                顯示全部 {others.length} 段
              </button>
            )}
          </>
        )}
        <div className="eyebrow">換個問法再試</div>
        <ul className="tips">
          <li>寫你記得的原話、人名或英文：節目裡說過的詞最容易找到。</li>
          <li>不確定是什麼時候，就不要寫時間：記錯的時間會讓搜尋漏掉那一集。</li>
          <li>一次問一件事。</li>
        </ul>
      </div>
    </details>
  );
}

function Preview({ s, f }: { s: Source; f: SourceFocus | undefined }) {
  const p = previewParts(s.text, f);
  return (
    <span className="x">
      {s.label && `${s.label}：`}
      {p.before}
      {p.words && <mark>{p.words}</mark>}
      {p.after}
    </span>
  );
}

function AnswerBlocks({ blocks, sources, focus }: { blocks: LabeledBlock[]; sources: Record<number, Source>; focus: Map<number, SourceFocus> }) {
  const groups = groupBlocks(blocks);
  // Each line that cites something opens with its sources' episodes (labelBlocks)
  const parts = (b: LabeledBlock) => [
    b.eps.length > 0 && (
      <span key="ep" className="eplabel">
        {episodeLabel(b.eps)}
      </span>
    ),
    ...b.parts.map((p, i) => {
      if (p.kind === 'text') return <Fragment key={i}>{p.text}</Fragment>;
      if (p.kind === 'bold') return <b key={i}>{p.text}</b>;
      const s = sources[p.n]!;
      return (
        <Link key={i} className="cite" href={sourceHref(s, focus.get(p.n))} aria-label={`出處 ${p.n}：EP${s.ep} ${formatTimestamp(s.t)}`}>
          {p.n}
        </Link>
      );
    }),
  ];
  return groups.map((g, i) =>
    g.kind === 'ul' ? (
      <ul key={i}>
        {g.items.map((b, j) => (
          <li key={j}>{parts(b)}</li>
        ))}
      </ul>
    ) : (
      <p key={i}>{parts(g.items[0]!)}</p>
    ),
  );
}
