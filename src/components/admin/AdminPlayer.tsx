'use client';

import { type ReactNode, type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { offsetAt, type SeekModel, type SeekTable, seekModel, seekTarget } from '@/lib/seek';
import { formatTimestamp } from '@/lib/summary';
import { segmentAt } from '@/lib/transcript-edits';

// The admin episode page's player. Its seeking is a copy of EpisodeView's (see the comments
// there and src/lib/seek.ts), kept apart so the measured public player stays as it is; a fix
// to one belongs in the other too.

export type PlayerHandle = {
  // play: whether to play from there; by default it keeps playing or paused as it was
  seek: (t: number, play?: boolean) => void;
  // Moves by this many seconds from where it is, playing or paused as it was
  skip: (by: number) => void;
  pause: () => void;
  toggle: () => void;
};

type Props = {
  ref?: Ref<PlayerHandle>;
  audioUrl: string;
  duration: number;
  table: SeekTable | null;
  segments: readonly { start: number; end: number }[];
  // The index of the segment playing, −1 before anything played; called only when it changes,
  // so the transcript doesn't re-render on every time update
  onSegment: (index: number) => void;
  onPlaying: (playing: boolean) => void;
  // A seek from the bar itself (slider, −15 s, +30 s)
  onBarSeek?: () => void;
  // Shown at the end of the bar
  children?: ReactNode;
};

const SPEEDS = [1, 1.25, 1.5, 2];

export function AdminPlayer({ ref, audioUrl, duration, table, segments, onSegment, onPlaying, onBarSeek, children }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const toc = useRef<{ table: SeekTable; model: SeekModel } | null>(null);
  const offset = useRef(0);
  const settling = useRef<number | null>(null);
  const [t, setT] = useState(0);
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
      // A fresh load knows only the table of contents, so every seek lands where seekTarget
      // expects (EpisodeView)
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

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      seek: (to, play) => seek(Math.min(Math.max(0, to), duration), play ?? !audio.current?.paused),
      skip: (by) => seek(Math.min(Math.max(0, now.current + by), duration), !audio.current?.paused),
      pause: () => audio.current?.pause(),
      toggle,
    }),
    [seek, toggle, duration],
  );

  useEffect(() => {
    const model = seekModel();
    toc.current = table && model ? { table, model } : null;
  }, [table]);

  // The OS's media controls seek through seek() too. Keyed on whether there is a table, not on
  // the table: the page reloads its data every 5 s while edits are pending, parsing it anew
  const hasTable = table !== null;
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
  }, [hasTable, duration, seek]);

  // Like the public transcript, nothing is marked before anything played or was sought
  const index = segments.length && (playing || t > 0) ? segmentAt(segments, t) : -1;
  useEffect(() => onSegment(index), [index, onSegment]);
  useEffect(() => onPlaying(playing), [playing, onPlaying]);

  // On narrow screens the bar sits at the bottom, and the page's send bar goes above it
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement.style;
    const ro = new ResizeObserver(() => root.setProperty('--admin-player-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeProperty('--admin-player-h');
    };
  }, []);

  return (
    <>
      <audio
        ref={audio}
        src={audioUrl}
        preload="none"
        onSeeking={(e) => {
          const c = toc.current;
          if (settling.current !== null) return;
          offset.current = c?.model === 'entry' ? offsetAt(c.table, e.currentTarget.currentTime, 'entry') : 0;
        }}
        onSeeked={() => (settling.current = null)}
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
      <Bar
        box={bar}
        t={t}
        duration={duration}
        playing={playing}
        speed={speed}
        onToggle={toggle}
        onSeek={(to) => {
          onBarSeek?.();
          seek(Math.min(Math.max(0, to), duration), playing);
        }}
        onSpeed={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!;
          if (audio.current) audio.current.playbackRate = next;
        }}
      >
        {children}
      </Bar>
    </>
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

// EpisodeView's Player, with a slot at the end
function Bar(props: {
  box: Ref<HTMLDivElement>;
  t: number;
  duration: number;
  playing: boolean;
  speed: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onSpeed: () => void;
  children?: ReactNode;
}) {
  const { duration, playing, speed } = props;
  // While the slider is dragged it only moves the shown time; the seek happens on release
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
    const el = range.current;
    el?.addEventListener('change', commit);
    return () => el?.removeEventListener('change', commit);
  }, [commit]);
  return (
    <div className="player admin-player" role="region" aria-label="播放器" ref={props.box}>
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
      <span className="admin-player-extra">{props.children}</span>
    </div>
  );
}
