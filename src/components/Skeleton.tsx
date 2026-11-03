// Grey placeholder bars for the loading.tsx screens, shaped like the page that is coming
export function Bar({ w, h = 14, r }: { w: number | string; h?: number; r?: number }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r }} aria-hidden />;
}

export function Loading({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-busy>
      {/* Live regions announce their text, not aria-label */}
      <span className="sr-only">載入中</span>
      {children}
    </div>
  );
}
