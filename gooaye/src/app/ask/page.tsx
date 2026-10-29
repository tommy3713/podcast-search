import type { Metadata } from 'next';
import { AskView } from '@/components/AskView';
import { LoginButton } from '@/components/UserMenu';
import { remaining, USER_DAILY_LIMIT } from '@/lib/ask/quota';
import { currentUser } from '@/lib/auth';
import { countEpisodes } from '@/lib/episodes';
import { readDb } from '@/lib/server-db';

export const metadata: Metadata = { title: '問答' };

const EXAMPLES = ['孟恭最近喜歡做的運動是什麼？', '主委推薦過哪些電影或影集？', '主委對 Anthropic IPO 的看法？'];

export default async function AskPage() {
  const [user, count] = await Promise.all([currentUser(), countEpisodes()]);
  if (!user) {
    return (
      <div className="ask">
        <div className="ask-head">
          <h1>問所有集數</h1>
        </div>
        <div className="card gate">
          <h2>登入後才能問答</h2>
          <p style={{ margin: 0 }} className="muted">
            每次回答都會呼叫 AI 搜尋逐字稿，所以需要登入，每人每天可以問 {USER_DAILY_LIMIT} 次。閱讀集數和逐字稿不需要登入。
          </p>
          <LoginButton callbackUrl="/ask" />
        </div>
      </div>
    );
  }
  return <AskView episodeCount={count} initialQuota={remaining(await readDb(), user.id)} dailyLimit={USER_DAILY_LIMIT} examples={EXAMPLES} />;
}
