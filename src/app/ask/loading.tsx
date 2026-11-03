import { Bar, Loading } from '@/components/Skeleton';

// Shown while /ask checks the login and quota. Neutral on purpose: logged-out visitors get the
// login card, logged-in ones the question box, so it draws neither an input nor a button.
export default function AskLoading() {
  return (
    <Loading>
      <div className="ask">
        <div className="ask-head">
          <Bar w={168} h={34} />
        </div>
        <div className="card" style={{ padding: 22, display: 'grid', gap: 12 }}>
          <Bar w="40%" h={22} />
          <Bar w="92%" />
          <Bar w="70%" />
        </div>
      </div>
    </Loading>
  );
}
