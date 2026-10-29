import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card placeholder">
      <h2 className="display" style={{ margin: 0 }}>找不到這一頁</h2>
      <p className="muted" style={{ margin: 0 }}>這一集可能還沒收錄，或網址打錯了。</p>
      <Link className="btn" href="/" style={{ justifySelf: 'start' }}>
        回到所有集數
      </Link>
    </div>
  );
}
