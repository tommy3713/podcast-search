import { Bar, Loading } from '@/components/Skeleton';

// Shown while an episode loads: header, player, tabs and the summary's chapter card
export default function EpisodeLoading() {
  return (
    <Loading>
      <div className="back">
        <Bar w={80} />
      </div>
      <div className="ep-head">
        <Bar w={68} h={68} r={14} />
        <div style={{ flex: 1 }}>
          <Bar w="55%" h={34} />
          <Bar w={140} h={13} />
          <Bar w="90%" />
        </div>
      </div>
      <div className="player">
        <span className="skel-span">
          <Bar w="100%" h={28} />
        </span>
      </div>
      <div className="tabs">
        <span className="skel-tab">
          <Bar w={32} />
        </span>
        <span className="skel-tab">
          <Bar w={48} />
        </span>
      </div>
      <div className="sum-grid">
        <div className="card">
          {[3, 4, 3].map((n, i) => (
            <section key={i} className="chapter">
              <Bar w="45%" h={20} />
              <div className="bul">
                {Array.from({ length: n }, (_, k) => (
                  <div className="skel-li" key={k}>
                    <Bar w={42} h={20} />
                    <Bar w={`${90 - k * 9}%`} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <aside className="side">
          <section className="card">
            <Bar w={64} h={16} />
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <Bar w="80%" />
              <Bar w="66%" />
              <Bar w="74%" />
            </div>
          </section>
        </aside>
      </div>
    </Loading>
  );
}
