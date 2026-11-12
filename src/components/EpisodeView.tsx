'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Paragraph } from '@/lib/format';
import { offsetAt, type SeekModel, type SeekTable, seekModel, seekTarget } from '@/lib/seek';
import { formatTimestamp, type Summary } from '@/lib/summary';

type Tab = 'summary' | 'tx';

type Props = {
  audioUrl: string;
  duration: number;
  summary: Summary;
  paragraphs: Paragraph[];
  initialTab: Tab;
  initialT: number | null;
  seek: SeekTable | null;
};

const SPEEDS = [1, 1.25, 1.5, 2];

export function EpisodeView({ audioUrl, duration, summary, paragraphs, initialTab, initialT, seek: table }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  // Everything here works in audio time: where the listener really is. In Chromium and Safari,
  // which seek through the MP3's table of contents (src/lib/seek.ts), that's currentTime plus
  // the offset of the last seek, and a seek to x sets currentTime to whatever lands nearest x.
  const toc = useRef<{ table: SeekTable; model: SeekModel } | null>(null);
  const offset = useRef(0);
  // The currentTime a reload for a seek is heading to: until it gets there, currentTime reads 0
  // (no seeked event when it's 0 itself)
  const settling = useRef<number | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [t, setT] = useState(initialT ?? 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const now = useRef(t);
  now.current = t;

  const seek = useCallback((to: number, play = true) => {
    const a = audio.current;
    if (!a) return;
    const c = toc.current;
    if (!c) {
      a.currentTime = to;
      setT(to);
    } else {
      // Where a seek lands also depends on what the element has read: Chromium indexes every
      // packet it read, stamped with the offset of the seek that led there (+30 s after a seek
      // at 40:30 played 17 s early), and Safari seeks a played element by average bitrate
      // instead. A fresh load knows only the table of contents, so every seek lands where
      // seekTarget expects.
      if (a.readyState > HTMLMediaElement.HAVE_NOTHING) {
        const rate = a.playbackRate;
        a.defaultPlaybackRate = rate;
        a.load();
        a.playbackRate = rate;
      }
      const at = seekTarget(c.table, to, c.model);
      if (a.readyState === HTMLMediaElement.HAVE_NOTHING) settling.current = at;
      a.currentTime = at;
      offset.current = offsetAt(c.table, at, c.model);
      setT(at + offset.current);
    }
    if (play) a.play().catch(() => {});
  }, []);

  // A ?t= link positions the player without autoplay (browsers block it anyway). Decided here
  // rather than on the server, which can't tell the browser.
  useEffect(() => {
    const model = seekModel();
    toc.current = table && model ? { table, model } : null;
    if (initialT !== null) seek(initialT, false);
  }, [table, initialT, seek]);

  // The OS's media controls (lock screen, notification, media keys) seek through seek() too
  useEffect(() => {
    const ms = typeof navigator === 'undefined' ? undefined : navigator.mediaSession;
    if (!ms || !toc.current) return;
    const playingNow = () => !!audio.current && !audio.current.paused;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['seekto', (d) => d.seekTime !== undefined && seek(Math.min(Math.max(0, d.seekTime), duration), playingNow())],
      ['seekbackward', (d) => seek(Math.max(0, now.current - (d.seekOffset ?? 15)), playingNow())],
      ['seekforward', (d) => seek(Math.min(duration, now.current + (d.seekOffset ?? 30)), playingNow())],
    ];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
      } catch {}
    }
    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {}
      }
    };
  }, [table, duration, seek]);

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
        // seek() has set the offset already. A seek from anywhere else is on an element that
        // has read things, so the models only guess: Chromium's still often holds, while
        // Safari then seeks by average bitrate, a few seconds off at most
        onSeeking={(e) => {
          const c = toc.current;
          if (settling.current !== null) return;
          offset.current = c?.model === 'entry' ? offsetAt(c.table, e.currentTarget.currentTime, 'entry') : 0;
        }}
        onSeeked={() => (settling.current = null)}
        // A browser that dropped the seek plays from wherever it is: show that, uncorrected,
        // rather than a time that never moves
        onPlaying={(e) => {
          if (settling.current === null) return;
          if (Math.abs(e.currentTarget.currentTime - settling.current) > 1) offset.current = 0;
          settling.current = null;
        }}
        onTimeUpdate={(e) => {
          const ct = e.currentTarget.currentTime;
          if (settling.current !== null) {
            if (Math.abs(ct - settling.current) > 1) return;
            settling.current = null;
          }
          const at = Math.min(duration, Math.max(0, ct + offset.current));
          setT(at);
          // The lock screen shows this rather than currentTime, so its scrubber and seekTime
          // are in audio time too
          if (toc.current && 'mediaSession' in navigator) {
            try {
              navigator.mediaSession.setPositionState({ duration, playbackRate: e.currentTarget.playbackRate, position: at });
            } catch {}
          }
        }}
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
      {/* Both panels are always rendered, so the transcript is in the server HTML for search
          engines; the inactive one is hidden. data-nosnippet keeps it indexed but out of result
          snippets, which use the description and key points instead of raw speech-to-text. */}
      <div role="tabpanel" hidden={tab !== 'summary'}>
        <SummaryTab summary={summary} onSeek={seek} />
      </div>
      <div role="tabpanel" hidden={tab !== 'tx'} data-nosnippet="">
        {/* While hidden it gets a fixed time, so playback (about 4 updates a second) doesn't
            re-render the whole transcript */}
        <TranscriptTab
          paragraphs={paragraphs}
          chapters={summary.chapters}
          t={tab === 'tx' ? t : 0}
          playing={tab === 'tx' && playing}
          active={tab === 'tx'}
          flashAt={initialT}
          onSeek={seek}
        />
      </div>
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
  const { duration, playing, speed } = props;
  // While the slider is dragged it only moves the shown time; the seek happens on release,
  // since a seek can reload the audio (EpisodeView)
  const [scrub, setScrub] = useState<number | null>(null);
  const t = scrub ?? props.t;
  const range = useRef<HTMLInputElement>(null);
  const pending = useRef<number | null>(null);
  const onSeek = useRef(props.onSeek);
  onSeek.current = props.onSeek;
  const commit = useCallback(() => {
    if (pending.current === null) return;
    onSeek.current(pending.current);
    pending.current = null;
    setScrub(null);
  }, []);
  useEffect(() => {
    // The native change event fires once, on release (React's onChange is the input event)
    const el = range.current;
    el?.addEventListener('change', commit);
    return () => el?.removeEventListener('change', commit);
  }, [commit]);
  return (
    <div className="player" role="region" aria-label="播放器">
      <button className="pbtn back15" onClick={() => props.onSeek(props.t - 15)} aria-label="倒退 15 秒">
        <Icon d={icon.back} />
      </button>
      <button className="pbtn main" onClick={props.onToggle} aria-label={playing ? '暫停' : '播放'}>
        <Icon d={playing ? icon.pause : icon.play} />
      </button>
      <button className="pbtn" onClick={() => props.onSeek(props.t + 30)} aria-label="快轉 30 秒">
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
        ref={range}
        value={Math.floor(t)}
        onChange={(e) => {
          pending.current = Number(e.target.value);
          setScrub(pending.current);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
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

const TranscriptTab = memo(function TranscriptTab(props: {
  paragraphs: Paragraph[];
  chapters: Summary['chapters'];
  t: number;
  playing: boolean;
  // Hidden panels don't scroll the page or flash paragraphs
  active: boolean;
  flashAt: number | null;
  onSeek: (t: number) => void;
}) {
  const { paragraphs, chapters, t, playing, active, flashAt, onSeek } = props;
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

  // Arriving from a ?t= link: flash the paragraph that contains it once the panel is shown
  useEffect(() => {
    if (!active || flashAt === null || !paragraphs.length) return;
    const el = box.current?.querySelector(`[data-i="${paragraphAt(paragraphs, flashAt)}"]`);
    el?.classList.add('flash');
    el?.scrollIntoView({ block: 'center' });
  }, [active, flashAt, paragraphs]);

  useEffect(() => {
    if (active && playing && follow && !query) scrollTo(box.current?.querySelector(`[data-i="${current}"]`));
  }, [active, current, playing, follow, query]);

  useEffect(() => {
    if (active && query) scrollTo(box.current?.querySelector(`mark[data-h="${hit}"]`));
  }, [active, hit, query]);

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
});
