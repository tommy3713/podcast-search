import type { ChartBar } from '@/lib/stocks';

// How many episodes brought something up over time (a stock, a sponsor's ad): when and how
// much, nothing about what he thought. One colour, on purpose.
export function MonthChart({ bars, what = '提到' }: { bars: ChartBar[]; what?: string }) {
  const max = Math.max(...bars.map((b) => b.mentioned));
  const gaps = bars.some((b) => b.episodes === 0);
  // A year under its first bar, the first one only when the next is far enough not to run into it
  const years = bars.map((b, i) => (i === 0 || b.year !== bars[i - 1]!.year ? b.year : ''));
  const next = years.findIndex((y, i) => i > 0 && y !== '');
  if (next !== -1 && next < 4) years[0] = '';
  return (
    <section className="card stock-chart" aria-label={`${what}的集數，依時間`}>
      <div className="fine">
        什麼時候{what}（最高的一格 {max} 集）{gaps && '・虛線是還沒收錄的時間'}
      </div>
      <div className="bars">
        {bars.map((b) => {
          if (b.target === null) {
            return <span key={b.label} className={b.episodes === 0 ? 'none' : 'zero'} title={`${b.label}：${b.episodes === 0 ? '還沒收錄' : `沒有${what}`}`} />;
          }
          const text = `${b.label}：${b.mentioned} 集${what}（收錄 ${b.episodes} 集）`;
          return <a key={b.label} href={`#m-${b.target}`} title={text} aria-label={text} style={{ height: `${Math.max(10, (b.mentioned / max) * 100)}%` }} />;
        })}
      </div>
      <div className="bar-years" aria-hidden="true">
        {bars.map((b, i) => (
          <span key={b.label}>{years[i]}</span>
        ))}
      </div>
    </section>
  );
}

