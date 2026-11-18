import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { AskShowcase, AskView } from '@/components/AskView';
import { LoginButton } from '@/components/UserMenu';
import { MAX_QUESTION_CHARS } from '@/lib/ask/agent';
import { anonAllowed, anonToken, anonVisitor, clientAddress, cookieValue } from '@/lib/ask/anon';
import { ANON_DAILY_LIMIT, ASK_LOG_DAYS, remaining, taipeiDate, USER_DAILY_LIMIT } from '@/lib/ask/quota';
import { showcase } from '@/lib/ask/showcase';
import { currentUser } from '@/lib/auth';
import { countEpisodes } from '@/lib/episodes';
import { readDb } from '@/lib/server-db';

// Answers differ per question and visitor; nothing here belongs in search results
export const metadata: Metadata = { title: 'AI問答', robots: { index: false, follow: true } };

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
  // The example questions are the ones answered ahead of time (showcase.ts): a pick shows
  // that answer and never asks, so it costs no one a question
  const examples = showcase();
  const questions = examples.map((x) => x.q);
  // Signed out, a few questions a day under the browser's id for the day (anon.ts); one that
  // hasn't asked yet has no cookie and all of them left
  const h = await headers();
  const address = user ? null : clientAddress(h);
  if (!user && anonAllowed(address)) {
    const visitor = anonVisitor(anonToken(cookieValue(h)), address, taipeiDate());
    return (
      <AskView
        episodeCount={count}
        initialQuota={visitor ? remaining(await readDb(), visitor.id) : ANON_DAILY_LIMIT}
        dailyLimit={ANON_DAILY_LIMIT}
        loginLimit={USER_DAILY_LIMIT}
        logDays={ASK_LOG_DAYS}
        examples={questions}
        showcase={examples}
        initialQuestion={question}
        signedIn={false}
      />
    );
  }
  if (!user) {
    // No address to count a visitor by (live, a request that didn't come through Cloudflare):
    // the login card, with the asked-ahead answers showing what a question gets
    return (
      <div className="ask">
        <div className="ask-head">
          <div>
            <h1>問所有集數</h1>
            <div className="fine">目前收錄 {count} 集，回答會附上集數和時間點</div>
          </div>
        </div>
        <div className="card gate">
          <h2>登入就能自己問</h2>
          <p style={{ margin: 0 }} className="muted">
            用一句話問節目內容，AI 會搜尋所有集數的逐字稿，回答附上是哪一集、哪個時間點。每人每天可以問 {USER_DAILY_LIMIT} 次；閱讀集數和逐字稿不需要登入。
          </p>
          {/* The question comes back after the login */}
          <LoginButton callbackUrl={question ? `/ask?q=${encodeURIComponent(question)}` : '/ask'} />
          <p style={{ margin: 0 }} className="fine">
            登入只保存 Google 帳號識別碼和顯示名稱，用來計算每日次數；問答紀錄保存 {ASK_LOG_DAYS} 天後自動刪除。
            <Link href="/about#privacy">隱私說明</Link>
          </p>
        </div>
        <AskShowcase questions={questions} items={examples} title="看看 AI 怎麼回答" hint="點題目看預先產生的範例回答。" />
      </div>
    );
  }
  return <AskView episodeCount={count} initialQuota={remaining(await readDb(), user.id)} dailyLimit={USER_DAILY_LIMIT} logDays={ASK_LOG_DAYS} examples={questions} initialQuestion={question} />;
}
