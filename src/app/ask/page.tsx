import type { Metadata } from 'next';
import Link from 'next/link';
import { AskView } from '@/components/AskView';
import { LoginButton } from '@/components/UserMenu';
import { MAX_QUESTION_CHARS } from '@/lib/ask/agent';
import { ASK_LOG_DAYS, remaining, USER_DAILY_LIMIT } from '@/lib/ask/quota';
import { currentUser } from '@/lib/auth';
import { countEpisodes } from '@/lib/episodes';
import { readDb } from '@/lib/server-db';

// Answers need a login and differ per question; nothing here belongs in search results
export const metadata: Metadata = { title: 'AI問答', robots: { index: false, follow: true } };

const EXAMPLES = ['孟恭最近喜歡做的運動是什麼？', '主委推薦過哪些電影或影集？', '主委對 Anthropic IPO 的看法？'];

// ?q= fills in the question box (a stock's page links here with one). It is never sent by
// itself: a question costs one of the day's.
function initialQuestion(q: string | string[] | undefined): string {
  if (typeof q !== 'string') return '';
  // By code point, so the cut never splits an emoji or a rare character in two (half of one
  // makes encodeURIComponent throw), and within the length the API accepts
  let out = '';
  for (const ch of q.trim()) {
    if (out.length + ch.length > MAX_QUESTION_CHARS) break;
    out += ch;
  }
  return out.trim();
}

export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const [user, count] = await Promise.all([currentUser(), countEpisodes()]);
  const question = initialQuestion((await searchParams).q);
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
          {/* The question comes back after the login */}
          <LoginButton callbackUrl={question ? `/ask?q=${encodeURIComponent(question)}` : '/ask'} />
          <p style={{ margin: 0 }} className="fine">
            登入只保存 Google 帳號識別碼和顯示名稱，用來計算每日次數；問答紀錄保存 {ASK_LOG_DAYS} 天後自動刪除。
            <Link href="/about#privacy">隱私說明</Link>
          </p>
        </div>
      </div>
    );
  }
  return <AskView episodeCount={count} initialQuota={remaining(await readDb(), user.id)} dailyLimit={USER_DAILY_LIMIT} logDays={ASK_LOG_DAYS} examples={EXAMPLES} initialQuestion={question} />;
}
