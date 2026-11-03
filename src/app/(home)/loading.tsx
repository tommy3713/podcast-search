import { Bar, Loading } from '@/components/Skeleton';

// Shown while the episode list loads. In a route group so it wraps only the home page: a
// root loading.tsx would also wrap /ep/[no]/layout.tsx and turn its 404s into 200s
export default function HomeLoading() {
  return (
    <Loading>
      <div className="home">
        <div className="card hero">
          <div className="hero-top">
            <Bar w={68} h={68} r={14} />
            <div style={{ flex: 1 }}>
              <Bar w={56} h={12} />
              <Bar w="70%" h={26} />
              <Bar w={140} h={13} />
            </div>
          </div>
          <Bar w="92%" />
          <div className="keypts">
            <Bar w="84%" />
            <Bar w="76%" />
            <Bar w="80%" />
          </div>
        </div>
        <div className="card list">
          <div className="list-head">
            <Bar w={120} h={16} />
          </div>
          {Array.from({ length: 6 }, (_, i) => (
            <div className="ep-row" key={i}>
              <Bar w={52} h={52} r={12} />
              <div style={{ display: 'grid', gap: 8 }}>
                <Bar w="40%" />
                <Bar w="85%" h={13} />
              </div>
              <Bar w={36} h={13} />
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}
