// A card's preview of how often a topic comes up, month by month: a line, or bars for the big
// cards. Drawn on the server; nothing moves but the draw-in.
// A month that is null (the site has no episode for it) is left blank: no bar, a break in the line.
export function Sparkline({ series, bars = false, label }: { series: (number | null)[]; bars?: boolean; label: string }) {
  const max = Math.max(1, ...series.map((v) => v ?? 0));
  const n = series.length;
  if (n === 0) return null;
  if (bars) {
    const w = 100 / n;
    return (
      <svg className="spark bars" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={label}>
        {series.map((v, i) => {
          if (v === null) return null;
          const h = (v / max) * 36;
          return <rect key={i} x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={h} rx={0.6} style={{ ['--i' as string]: i }} />;
        })}
      </svg>
    );
  }
  // One stretch per run of months the site has
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const runs: [number, number][][] = [[]];
  series.forEach((v, i) => {
    if (v === null) {
      if (runs.at(-1)!.length) runs.push([]);
    } else runs.at(-1)!.push([x(i), 38 - (v / max) * 34]);
  });
  return (
    <svg className="spark line" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={label}>
      {runs
        .filter((r) => r.length)
        .map((r, k) => {
          const pts = r.map(([a, b]) => `${a},${b}`).join(' ');
          return (
            <g key={k}>
              <polygon points={`${r[0]![0]},40 ${pts} ${r.at(-1)![0]},40`} />
              <polyline points={pts} />
            </g>
          );
        })}
    </svg>
  );
}

// The few biggest of something, as labelled bars: a sponsor card's preview
export function TopBars({ rows, label }: { rows: { name: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="topbars" role="img" aria-label={label}>
      {rows.map((r, i) => (
        <div key={r.name} className="topbar" style={{ ['--i' as string]: i }}>
          <span className="n">{r.name}</span>
          <span className="b" style={{ width: `${(r.value / max) * 100}%` }} />
          <span className="v">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
