import type { Metadata } from 'next';
import { ASK_LOG_DAYS } from '@/lib/ask/quota';
import { shareMetadata } from '@/lib/seo';

export const metadata: Metadata = {
  title: '關於與聲明',
  alternates: { canonical: '/about' },
  ...shareMetadata('關於與聲明・股癌搜尋', '/about'),
};

export default function About() {
  return (
    <article className="card about">
      <h1>關於與聲明</h1>
      <h2>非官方網站</h2>
      <p>
        股癌搜尋是粉絲自製的網站，與《股癌 Gooaye》節目及謝孟恭先生沒有任何關係，也沒有獲得授權或背書。節目內容的著作權屬於原作者。
      </p>
      <h2>內容由 AI 自動產生</h2>
      <p>
        逐字稿由語音辨識（Groq Whisper）自動轉出，重點整理、提到的標的和本集提到的清單由 AI（OpenAI GPT）產生，可能有錯字、誤聽或遺漏。引用前請點時間戳聽原音，一切以原節目為準。請到
        Apple Podcasts、Spotify 等平台收聽原節目。
      </p>
      <h2>不是投資建議</h2>
      <p>
        本站只整理節目內容，不構成任何投資建議，也不推薦買賣任何證券。主持人在節目中的看法是他個人的意見，投資決策請自行判斷並承擔風險。
      </p>
      <h2 id="privacy">隱私</h2>
      <p>
        用 Google 登入時，本站保存你的 Google 帳號識別碼和顯示名稱，用來計算每日問答次數。你在問答輸入的問題會傳給 OpenAI
        產生回答；問題和回答會連同帳號識別碼保存 {ASK_LOG_DAYS} 天，用來調查濫用、改善回答品質，期滿自動刪除（備份裡也不保留），之後只留下不含內容的每日統計數字。
        網站流量由 Cloudflare 統計，不使用 cookie，也不追蹤個人。這些資料不會販售或分享給第三方。
      </p>
      <h2>聯絡與下架</h2>
      <p>
        如果你是權利人，認為本站內容有侵權疑慮，請來信 <span className="mono">haotangli.hl@gmail.com</span>
        ，我們會儘快處理或下架。
      </p>
    </article>
  );
}
