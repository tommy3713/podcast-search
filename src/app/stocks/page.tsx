import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, shareMetadata } from '@/lib/seo';
import { stockIndex } from '@/lib/stock-pages';
import { listedStocks, MARKET_LABELS, STOCK_LIST_MIN_EPISODES, STOCKS_LABEL, shownCode, stockHref } from '@/lib/stocks';

const TITLE = `股癌提過的公司與 ETF・${SITE_NAME}`;
const DESCRIPTION = '《股癌》節目裡提過的公司和 ETF：每一個在哪幾集、第幾分鐘提到，主持人說了什麼。非官方粉絲整理，不是投資建議。';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/stocks' },
  ...shareMetadata(TITLE, '/stocks', DESCRIPTION),
};

export default async function StocksPage() {
  const groups = listedStocks(await stockIndex());
  const total = groups.reduce((n, g) => n + g.stocks.length, 0);

  if (total === 0) {
    return (
      <div className="home">
        <div className="card placeholder">
          <h2 className="display" style={{ margin: 0 }}>還沒有可以列出的{STOCKS_LABEL}</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="home">
      <div className="stock-head">
        <h1>{STOCKS_LABEL}</h1>
        <p className="muted" style={{ margin: 0 }}>
          節目裡在 {STOCK_LIST_MIN_EPISODES} 集以上提過的公司和 ETF，共 {total} 個。照代號或名稱排列，不是排行，也不是推薦。
        </p>
      </div>
      <section className="card list" id="stock-list">
        {groups.map((g) => (
          <div key={g.market}>
            <h2 className="month">
              {MARKET_LABELS[g.market]}
              <span className="fine">　{g.stocks.length} 個</span>
            </h2>
            <div className="stock-grid">
              {/* No prefetch: a request per link would be a couple of hundred for one visit */}
              {g.stocks.map((s) => (
                <Link key={s.slug} href={stockHref(s)} prefetch={false}>
                  <span className="n">{s.name}</span>
                  {shownCode(s) && <span className="c">{s.code}</span>}
                  <span className="fine">{s.episodes.length} 集</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>
      <p className="fine" style={{ margin: 0 }}>
        主持人在節目中的個人看法，不是投資建議。內容由 AI 自動整理，可能有遺漏或誤聽，以原節目為準。
      </p>
    </div>
  );
}
