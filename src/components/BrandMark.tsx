// A sound wave under a magnifying glass. app/icon.svg is the same mark cut down for 16 px tabs;
// globals.css colours both parts by theme (--logo-ink, --logo-ring).
const WAVE: [x: number, h: number][] = [
  // outside the glass, left
  [8, 4.4], [12, 9.4], [16, 17.4], [20, 9.8],
  // inside it
  [30, 6.6], [34, 13.8], [38, 22.4], [42, 9.8], [46, 16], [50, 5.4],
  // outside, right
  [61, 11.6], [65, 5.8],
];

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="6 13 61 43" aria-hidden="true">
      <g className="bm-ink">
        {WAVE.map(([x, h]) => (
          <rect key={x} x={x - 1.1} y={32 - h / 2} width="2.2" height={h} rx="1.1" />
        ))}
        <path transform="translate(40 32) rotate(45)" d="M20 -3 L28 -3 A3 3 0 0 1 28 3 L20 3 Z" />
      </g>
      <g className="bm-ring" fill="none">
        <path d="M52.73 44.73 L54.5 46.5" strokeWidth="2" />
        <circle cx="40" cy="32" r="16" strokeWidth="4" />
      </g>
    </svg>
  );
}
