'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { AskEvent, Source } from '@/lib/ask/agent';
import { type Block, citedOrder, parseAnswer, splitEvents } from '@/lib/ask/render';
import { formatTimestamp } from '@/lib/summary';

type Msg = {
  id: string;
  q: string;
  status: string | null;
  sources: Record<number, Source>;
  text: string;
  done: boolean;
  error: string | null;
};

type Props = { episodeCount: number; initialQuota: number; dailyLimit: number; examples: string[] };

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

export function AskView({ episodeCount, initialQuota, dailyLimit, examples }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [quota, setQuota] = useState(initialQuota);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
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
    const id = `${Date.now()}`;
    setMsgs((all) => [...all, { id, q: text, status: null, sources: {}, text: '', done: false, error: null }]);
    setQ('');
    setBusy(true);
    requestAnimationFrame(() => document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 429) setQuota(0);
        update(id, (m) => ({ ...m, error: body.error ?? '發生錯誤，請稍後再試。', done: true }));
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const { events, rest } = splitEvents(buf + value);
        buf = rest;
        for (const raw of events) apply(id, JSON.parse(raw) as AskEvent);
      }
      update(id, (m) => ({ ...m, done: true }));
    } catch {
      update(id, (m) => ({ ...m, error: m.error ?? '連線中斷，請再試一次。', done: true }));
    } finally {
      setBusy(false);
    }
  }

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
        </div>
      )}

      <div style={{ display: 'grid', gap: 28 }}>
        {msgs.map((m) => (
          <Message key={m.id} m={m} />
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

function Message({ m }: { m: Msg }) {
  const known = new Set(Object.keys(m.sources).map(Number));
  const blocks = parseAnswer(m.text, known, !m.done);
  const cited = citedOrder(blocks)
    .map((n) => m.sources[n])
    .filter((s): s is Source => !!s);
  const found = Object.keys(m.sources).length;

  return (
    <article className="msg" id={`msg-${m.id}`}>
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
            <Link key={s.n} className="src" href={`/ep/${s.ep}?t=${s.t}`}>
              <span className="h">
                <span className="n">{s.n}</span>EP{s.ep}
                <span className="mono muted" style={{ fontWeight: 400 }}>
                  {formatTimestamp(s.t)}
                </span>
              </span>
              <span className="x">{s.label ? `${s.label}：${s.text}` : s.text}</span>
            </Link>
          ))}
        </div>
      )}
      {(m.text || m.done) && !(m.error && !m.text) && (
        <div className="card ans">
          <AnswerBlocks blocks={blocks} sources={m.sources} />
          {!m.done && <span className="caret" />}
        </div>
      )}
      {m.error && <div className="notice warn">{m.error}</div>}
      {m.done && !m.error && (
        <p className="fine" style={{ margin: 0 }}>
          AI 根據逐字稿產生，可能有誤，請點出處核對原節目；不是投資建議。
        </p>
      )}
    </article>
  );
}

function AnswerBlocks({ blocks, sources }: { blocks: Block[]; sources: Record<number, Source> }) {
  // Group consecutive list items into one <ul>
  const groups: { kind: 'p' | 'ul'; items: Block[] }[] = [];
  for (const b of blocks) {
    const kind = b.kind === 'li' ? 'ul' : 'p';
    const last = groups.at(-1);
    if (kind === 'ul' && last?.kind === 'ul') last.items.push(b);
    else groups.push({ kind, items: [b] });
  }
  const parts = (b: Block) =>
    b.parts.map((p, i) => {
      if (p.kind === 'text') return <Fragment key={i}>{p.text}</Fragment>;
      if (p.kind === 'bold') return <b key={i}>{p.text}</b>;
      const s = sources[p.n]!;
      return (
        <Link key={i} className="cite" href={`/ep/${s.ep}?t=${s.t}`} aria-label={`出處 ${p.n}：EP${s.ep} ${formatTimestamp(s.t)}`}>
          {p.n}
        </Link>
      );
    });
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
