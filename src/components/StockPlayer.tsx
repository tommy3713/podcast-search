'use client';

import Link from 'next/link';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { type PlayPoint, seekModel } from '@/lib/seek';
import { formatTimestamp } from '@/lib/summary';

type Play = (episodeNo: number, t: number, point: PlayPoint | null) => boolean;
const PlayContext = createContext<Play | null>(null);

const icon = { play: 'M8 5v14l11-7z', pause: 'M7 5h4v14H7zM13 5h4v14h-4z', close: 'M6 6l12 12M18 6L6 18' };

// Plays a spot of any episode on a stock's page, without leaving it. One audio element; each
// play is a fresh load's first seek, the one case src/lib/seek.ts models exactly, so the page
// can carry the currentTime to set and the offset that follows for each timestamp (PlayPoint)
// instead of every episode's seek table. From there it only plays on: to move around in the
// episode, the bar links to the episode's own player.
export function StockPlayer({ audio: urls, children }: { audio: Record<number, string>; children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  // Audio time is currentTime plus this (see EpisodeView)
  const offset = useRef(0);
  // The currentTime a load is heading to; until it gets there currentTime reads 0
  const settling = useRef<number | null>(null);
  const [episodeNo, setEpisodeNo] = useState<number | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);

  const play = useCallback<Play>(
    (no, to, point) => {
      const a = audio.current;
      const url = urls[no];
      // false: the link goes to the episode's page instead
      if (!a || !url) return false;
      const model = seekModel();
      const [at, off] = point && model ? point[model] : [to, 0];
      if (a.getAttribute('src') !== url) a.src = url;
      // Always a fresh load, also for a second spot of the same episode: where a seek lands
      // on an element that has read things is not what the table says
      a.load();
      settling.current = at;
      a.currentTime = at;
      offset.current = off;
      setEpisodeNo(no);
      setT(at + off);
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({ title: `股癌 EP${no}`, artist: '股癌 Gooaye' });
        } catch {}
      }
      a.play().catch(() => {});
      return true;
    },
    [urls],
  );

  function close() {
    audio.current?.pause();
    audio.current?.removeAttribute('src');
    audio.current?.load();
    setEpisodeNo(null);
  }

  return (
    <PlayContext.Provider value={play}>
      {children}
      <audio
        ref={audio}
        preload="none"
        // A seek that didn't come from play() (the OS's media controls) is on an element that
        // has read things, and the page has no table to model it with: show the time as the
        // browser gives it rather than carry the last play's offset along
        onSeeking={() => {
          if (settling.current === null) offset.current = 0;
        }}
        onSeeked={() => (settling.current = null)}
        // The audio can't be had (the feed moved it, or it is blocked): the episode's own page
        // is where the link went before, and it says what is wrong
        onError={() => {
          if (episodeNo !== null) window.location.assign(`/ep/${episodeNo}?t=${Math.floor(t)}`);
        }}
        // A browser that dropped the seek plays from wherever it is: show that, uncorrected
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
          setT(Math.max(0, ct + offset.current));
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      {episodeNo !== null && (
        <div className="mini-player" role="region" aria-label="播放中">
          <button
            className="pbtn"
            onClick={() => (playing ? audio.current?.pause() : audio.current?.play().catch(() => {}))}
            aria-label={playing ? '暫停' : '播放'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={playing ? icon.pause : icon.play} />
            </svg>
          </button>
          <div className="now">
            <b>EP{episodeNo}</b>
            <span className="mono">{formatTimestamp(t)}</span>
          </div>
          {/* The whole episode, from where this has got to */}
          <Link href={`/ep/${episodeNo}?t=${Math.floor(t)}`}>到這一集 →</Link>
          <button className="pbtn ghost" onClick={close} aria-label="關閉播放器">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={icon.close} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </PlayContext.Provider>
  );
}

// A timestamp that plays on the page. It is still a link to the episode at that time: for a
// page without the player, a browser without JavaScript, and a click meant for a new tab.
export function PlayTs({
  episodeNo,
  t,
  point,
  className = 'ts',
  children,
}: {
  episodeNo: number;
  t: number;
  point: PlayPoint | null;
  className?: string;
  children?: ReactNode;
}) {
  const play = useContext(PlayContext);
  return (
    <a
      className={className}
      href={`/ep/${episodeNo}?t=${t}`}
      aria-label={`播放 EP${episodeNo} 的 ${formatTimestamp(t)}`}
      onClick={(e) => {
        if (!play || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (play(episodeNo, t, point)) e.preventDefault();
      }}
    >
      {children ?? formatTimestamp(t)}
    </a>
  );
}
