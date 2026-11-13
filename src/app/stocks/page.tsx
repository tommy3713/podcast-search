import type { Metadata } from 'next';
import { StockList, type StockListGroup } from '@/components/StockList';
import { SITE_NAME, shareMetadata } from '@/lib/seo';
import { stockIndex } from '@/lib/stock-pages';
import { listedStocks, MARKET_LABELS, STOCK_LIST_MIN_EPISODES, STOCKS_LABEL, shownCode, stockHref, stockSearchText } from '@/lib/stocks';

const TITLE = `股癌提過的公司與 ETF・${SITE_NAME}`;
const DESCRIPTION = '《股癌》節目裡提過的公司和 ETF：每一個在哪幾集、第幾分鐘提到，主持人說了什麼。非官方粉絲整理，不是投資建議。';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/stocks' },
  ...shareMetadata(TITLE, '/stocks', DESCRIPTION),
};

export default async function StocksPage() {
  // Every page, for the search; the list itself shows those with enough episodes
  const groups: StockListGroup[] = listedStocks(await stockIndex(), 1).map((g) => ({
    label: MARKET_LABELS[g.market],
    stocks: g.stocks.map((s) => ({
      href: stockHref(s),
      name: s.name,
      code: shownCode(s),
      episodes: s.episodes.length,
      text: stockSearchText(s),
      listed: s.episodes.length >= STOCK_LIST_MIN_EPISODES,
    })),
  }));
  const total = groups.reduce((n, g) => n + g.stocks.filter((s) => s.listed).length, 0);

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
          節目裡在 {STOCK_LIST_MIN_EPISODES} 集以上提過的公司和 ETF，共 {total} 個。照代號或名稱排列。
        </p>
      </div>
      <StockList groups={groups} />
      <p className="fine" style={{ margin: 0 }}>
        主持人在節目中的個人看法，不是投資建議。內容由 AI 自動整理，可能有遺漏或誤聽，以原節目為準。
      </p>
    </div>
  );
}
