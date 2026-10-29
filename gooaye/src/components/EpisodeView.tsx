'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Paragraph } from '@/lib/format';
import { formatTimestamp, type Summary } from '@/lib/summary';

type Tab = 'summary' | 'tx';

type Props = {
  audioUrl: string;
  duration: number;
  summary: Summary;
  paragraphs: Paragraph[];
  initialTab: Tab;
  initialT: number | null;
};

const SPEEDS = [1, 1.25, 1.5, 2];

export function EpisodeView({ audioUrl, duration, summary, paragraphs, initialTab, initialT }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [t, setT] = useState(initialT ?? 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const seek = useCallback((to: number, play = true) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = to;
    setT(to);
    if (play) a.play().catch(() => {});
  }, []);

  // A ?t= link positions the player without autoplay (browsers block it anyway)
  useEffect(() => {
    if (initialT !== null && audio.current) audio.current.currentTime = initialT;
  }, [initialT]);

  function switchTab(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.delete('t');
    if (next === 'tx') url.searchParams.set('tab', 'tx');
    else url.searchParams.delete('tab');
    window.history.replaceState(null, '', url);
  }

  return (
    <>
      <audio
        ref={audio}
        src={audioUrl}
        preload="none"
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
      />
      <Player
        t={t}
        duration={duration}
        playing={playing}
        speed={speed}
        onToggle={() => (playing ? audio.current?.pause() : audio.current?.play().catch(() => {}))}
        onSeek={(to) => seek(Math.min(Math.max(0, to), duration), playing)}
        onSpeed={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
          if (audio.current) audio.current.playbackRate = next;
        }}
      />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'summary'} onClick={() => switchTab('summary')}>
          重點
        </button>
        <button role="tab" aria-selected={tab === 'tx'} onClick={() => switchTab('tx')}>
          逐字稿{paragraphs.length > 0 && <span className="count">{paragraphs.length} 段</span>}
        </button>
      </div>
      {tab === 'summary' ? (
        <SummaryTab summary={summary} onSeek={seek} />
      ) : (
        <TranscriptTab paragraphs={paragraphs} chapters={summary.chapters} t={t} playing={playing} flashAt={initialT} onSeek={seek} />
      )}
    </>
  );
}

function Ts({ t, onSeek }: { t: number; onSeek: (t: number) => void }) {
  return (
    <button className="ts" onClick={() => onSeek(t)} aria-label={`從 ${formatTimestamp(t)} 播放`}>
      {formatTimestamp(t)}
    </button>
  );
}

const icon = {
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  back: 'M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  fwd: 'M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z',
};
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

function Player(props: {
  t: number;
  duration: number;
  playing: boolean;
  speed: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onSpeed: () => void;
}) {
  const { t, duration, playing, speed } = props;
  return (
    <div className="player" role="region" aria-label="播放器">
      <button className="pbtn back15" onClick={() => props.onSeek(t - 15)} aria-label="倒退 15 秒">
        <Icon d={icon.back} />
      </button>
      <button className="pbtn main" onClick={props.onToggle} aria-label={playing ? '暫停' : '播放'}>
        <Icon d={playing ? icon.pause : icon.play} />
      </button>
      <button className="pbtn" onClick={() => props.onSeek(t + 30)} aria-label="快轉 30 秒">
        <Icon d={icon.fwd} />
      </button>
      <span className="ptime mono">
        {formatTimestamp(t)} / {formatTimestamp(duration)}
      </span>
      <input
        type="range"
        min={0}
        max={Math.floor(duration)}
        step={1}
        value={Math.floor(t)}
        onChange={(e) => props.onSeek(Number(e.target.value))}
        aria-label="播放進度"
      />
      <button className="pspeed" onClick={props.onSpeed} aria-label="播放速度">
        {speed}×
      </button>
    </div>
  );
}

function SummaryTab({ summary, onSeek }: { summary: Summary; onSeek: (t: number) => void }) {
  return (
    <div className="sum-grid">
      <div className="card">
        {summary.chapters.map((c, i) => (
          <section key={i} className={`chapter${c.ad ? ' ad' : ''}`}>
            <div className="ch-head">
              <Ts t={c.t} onSeek={onSeek} />
              <h3>{c.title}</h3>
              {c.ad && <span className="pill flat">業配</span>}
            </div>
            <ul className="bul">
              {c.bullets.map((b, j) => (
                <li key={j}>
                  <Ts t={b.t} onSeek={onSeek} />
                  <span>{b.text}</span>
                </li>
              ))}
            </ul>
            {c.quote && (
              <div className="quote">
                <span>「{c.quote.text}」</span>
                <Ts t={c.quote.t} onSeek={onSeek} />
              </div>
            )}
          </section>
        ))}
      </div>
      <aside className="side">
        {summary.stocks.length > 0 && (
          <section className="card">
            <h3>提到的標的</h3>
            {summary.stocks.map((s, i) => (
              <div key={i} className="stock">
                <div className="n">
                  {s.name}
                  {s.code && <span className="c">{s.code}</span>}
                </div>
                <p>
                  <span>{s.note}</span>
                  <Ts t={s.t} onSeek={onSeek} />
                </p>
              </div>
            ))}
            <p className="fine" style={{ margin: '10px 0 0' }}>
              主持人在節目中的個人看法，不是投資建議。
            </p>
          </section>
        )}
        {summary.mentions.length > 0 && (
          <section className="card">
            <h3>本集提到</h3>
            {summary.mentions.map((m, i) => (
              <div key={i} className="mention">
                <span className="cat">{m.category}</span>
                <div>
                  <b>{m.name}</b>　<span className="q">{m.quote}</span> <Ts t={m.t} onSeek={onSeek} />
                </div>
              </div>
            ))}
            <p className="fine" style={{ margin: '10px 0 0' }}>
              AI 自動整理，可能有遺漏或誤聽。
            </p>
          </section>
        )}
      </aside>
    </div>
  );
}

function paragraphAt(paragraphs: Paragraph[], t: number): number {
  let lo = 0;
  let hi = paragraphs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (paragraphs[mid]!.start <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Splits text around case-insensitive matches of q
function splitMatches(text: string, q: string): { s: string; hit: boolean }[] {
  if (!q) return [{ s: text, hit: false }];
  const out: { s: string; hit: boolean }[] = [];
  const lower = text.toLowerCase();
  const lq = q.toLowerCase();
  let i = 0;
  for (let j = lower.indexOf(lq); j !== -1; j = lower.indexOf(lq, j + lq.length)) {
    if (j > i) out.push({ s: text.slice(i, j), hit: false });
    out.push({ s: text.slice(j, j + q.length), hit: true });
    i = j + q.length;
  }
  if (i < text.length) out.push({ s: text.slice(i), hit: false });
  return out;
}

function TranscriptTab(props: {
  paragraphs: Paragraph[];
  chapters: Summary['chapters'];
  t: number;
  playing: boolean;
  flashAt: number | null;
  onSeek: (t: number) => void;
}) {
  const { paragraphs, chapters, t, playing, flashAt, onSeek } = props;
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [hit, setHit] = useState(0);
  const [follow, setFollow] = useState(true);
  const query = q.trim();
  const current = paragraphs.length ? paragraphAt(paragraphs, t) : -1;

  const parts = useMemo(() => paragraphs.map((p) => splitMatches(p.text, query)), [paragraphs, query]);
  const hits = query ? parts.reduce((n, ps) => n + ps.filter((x) => x.hit).length, 0) : 0;

  const scrollTo = (el: Element | null | undefined) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  };

  // Arriving from a ?t= link: flash the paragraph that contains it
  useEffect(() => {
    if (flashAt === null || !paragraphs.length) return;
    const el = box.current?.querySelector(`[data-i="${paragraphAt(paragraphs, flashAt)}"]`);
    el?.classList.add('flash');
    el?.scrollIntoView({ block: 'center' });
  }, [flashAt, paragraphs]);

  useEffect(() => {
    if (playing && follow && !query) scrollTo(box.current?.querySelector(`[data-i="${current}"]`));
  }, [current, playing, follow, query]);

  useEffect(() => {
    if (query) scrollTo(box.current?.querySelector(`mark[data-h="${hit}"]`));
  }, [hit, query]);

  if (!paragraphs.length) {
    return <div className="card placeholder"><p style={{ margin: 0 }}>這一集沒有逐字稿。</p></div>;
  }

  const step = (d: number) => hits && setHit((h) => (h + d + hits) % hits);
  let h = 0;
  let ci = 0;
  const rows: React.ReactNode[] = [];
  paragraphs.forEach((p, i) => {
    // Chapter headings go before the first paragraph that reaches them
    while (ci < chapters.length && chapters[ci]!.t <= p.start + 29) {
      const c = chapters[ci++]!;
      rows.push(
        <div key={`c${ci}`} className="tx-ch">
          <Ts t={c.t} onSeek={onSeek} />
          <span>{c.title}</span>
        </div>,
      );
    }
    rows.push(
      <div key={i} data-i={i} className={`para${i === current && (playing || t > 0) ? ' now' : ''}`}>
        <Ts t={p.start} onSeek={onSeek} />
        <p>
          {parts[i]!.map((x, k) => {
            if (!x.hit) return x.s;
            const n = h++;
            return (
              <mark key={k} data-h={n} className={n === hit ? 'cur' : undefined}>
                {x.s}
              </mark>
            );
          })}
        </p>
      </div>,
    );
  });

  return (
    <>
      <div className="tx-bar">
        <div className="field">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHit(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) step(e.shiftKey ? -1 : 1);
            }}
            placeholder="搜尋這集逐字稿"
            aria-label="搜尋這集逐字稿"
            autoComplete="off"
          />
        </div>
        <span className="hits" role="status">
          {query ? (hits ? `${Math.min(hit, hits - 1) + 1} / ${hits} 處` : '沒有符合') : ''}
        </span>
        <button className="btn" onClick={() => step(-1)} aria-label="上一個">↑</button>
        <button className="btn" onClick={() => step(1)} aria-label="下一個">↓</button>
        <label className="follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          跟著播放捲動
        </label>
      </div>
      <div className="card tx" ref={box}>
        {rows}
      </div>
    </>
  );
}
