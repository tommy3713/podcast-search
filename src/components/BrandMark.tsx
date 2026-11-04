// The shapes of app/icon.svg (tests/brand-mark.test.ts keeps them equal). The attributes hold the
// icon's colours; globals.css recolours them by theme so the square stays visible on a dark header.
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect className="bm-bg" width="32" height="32" rx="7" fill="#16202a" />
      <circle className="bm-fg" cx="14.5" cy="14.5" r="8.5" fill="none" stroke="#fff" strokeWidth="3" />
      <path className="bm-fg" d="M21 21 L26.5 26.5" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <g className="bm-wave" fill="#5bb5dc">
        <rect x="9" y="12" width="3" height="5" rx="1.5" />
        <rect x="13" y="9" width="3" height="11" rx="1.5" />
        <rect x="17" y="11" width="3" height="7" rx="1.5" />
      </g>
    </svg>
  );
}
