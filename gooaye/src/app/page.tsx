import Link from 'next/link';
import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { Badge, EpName } from '@/components/Badge';
import { Pager } from '@/components/Pager';
import { countEpisodes, getEpisode, latestEpisodeNo, listEpisodes, oldestEpisodeNo } from '@/lib/episodes';
import { formatDate, minutes, monthLabel } from '@/lib/format';
import { clampPage, PER_PAGE, pageCount, pageOffset } from '@/lib/paging';
import { formatTimestamp } from '@/lib/summary';

type Props = { searchParams: Promise<{ page?: string; ep?: string }> };

export default async function Home({ searchParams }: Props) {
  const sp = await searchParams;
  const total = await countEpisodes();
  if (total === 0) {
    return (
      <div className="home">
        <div className="card placeholder">
          <h2 className="display" style={{ margin: 0 }}>還沒有收錄任何集數</h2>
        </div>
      </div>
    );
  }

  // "跳到 EP" submits ?ep=N here so it works without JavaScript
  let jumpErr: string | null = null;
  if (sp.ep !== undefined) {
    const raw = sp.ep.trim();
    const no = Number.parseInt(raw, 10);
    if (Number.isInteger(no) && (await getEpisode(no))) redirect(`/ep/${no}`);
    const [oldest, newest] = [await oldestEpisodeNo(), await latestEpisodeNo()];
    jumpErr = raw
      ? `找不到 EP${raw.slice(0, 6)}，目前收錄 EP${oldest}–EP${newest}，中間可能有缺集。`
      : `請輸入集數，例如 ${newest}`;
  }

  const page = clampPage(sp.page, total);
  const pages = pageCount(total);
  const items = await listEpisodes(PER_PAGE, pageOffset(page));
  const latestNo = (await latestEpisodeNo())!;
  const hero = page === 1 ? await getEpisode(latestNo) : null;

  let month = '';
  return (
    <div className="home">
      {hero && (
        <article className="card hero">
          <div className="hero-top">
            <Badge title={hero.title} large />
            <div>
              <div className="eyebrow">最新一集</div>
              <h2>
                EP{hero.no}
                <EpName title={hero.title} />
              </h2>
              <div className="meta">
                <span>{formatDate(hero.publishedAt)}</span>
                {hero.duration && <span>{minutes(hero.duration)} 分鐘</span>}
              </div>
            </div>
          </div>
          <p style={{ margin: 0 }}>{hero.summary.line}</p>
          <ul className="keypts">
            {hero.summary.keys.map((k, i) => (
              <li key={i}>
                <Link className="ts" href={`/ep/${hero.no}?t=${k.t}`}>
                  {formatTimestamp(k.t)}
                </Link>
                <span>{k.text}</span>
              </li>
            ))}
          </ul>
          {hero.stocks.length > 0 && (
            <div className="chips">
              <span className="fine" style={{ alignSelf: 'center' }}>提到：</span>
              {hero.stocks.slice(0, 5).map((s, i) => (
                <span key={i} className="chip">{s}</span>
              ))}
              {hero.stocks.length > 5 && (
                <span className="fine" style={{ alignSelf: 'center' }}>等 {hero.stocks.length} 檔</span>
              )}
            </div>
          )}
          <div className="hero-links">
            <Link href={`/ep/${hero.no}`}>完整重點 →</Link>
            <Link href={`/ep/${hero.no}?tab=tx`}>逐字稿 →</Link>
          </div>
        </article>
      )}

      {items.length > 0 && (
        <section className="card list" id="ep-list">
          <div className="list-head">
            <h3>
              {page === 1 ? '更早的集數' : '所有集數'}
              <span className="fine">共 {total} 集</span>
            </h3>
            <form className="jump" role="search" action="/">
              <label htmlFor="jump-no">跳到 EP</label>
              <input id="jump-no" name="ep" inputMode="numeric" maxLength={4} placeholder={String(latestNo)} autoComplete="off" defaultValue={sp.ep} />
              <button className="btn" type="submit">前往</button>
              {jumpErr && <p className="jump-err" role="status">{jumpErr}</p>}
            </form>
          </div>
          {items.map((e) => {
            const m = monthLabel(e.publishedAt);
            const header = m !== month ? <h4 className="month">{(month = m)}</h4> : null;
            return (
              <Fragment key={e.no}>
                {header}
                <Link className="ep-row" href={`/ep/${e.no}`}>
                  <Badge title={e.title} />
                  <div style={{ minWidth: 0 }}>
                    <div className="t">
                      <span>EP{e.no}</span>
                      <EpName title={e.title} />
                      <span className="fine">{formatDate(e.publishedAt)}</span>
                    </div>
                    <div className="d">{e.line}</div>
                    {e.stocks.length > 0 && (
                      <div className="chips" style={{ marginTop: 6 }}>
                        {e.stocks.slice(0, 6).map((s, i) => (
                          <span key={i} className="chip">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="r">{e.duration && <span>{minutes(e.duration)} 分</span>}</div>
                </Link>
              </Fragment>
            );
          })}
          <Pager page={page} total={pages} />
          <p className="fine pager-note">
            EP{items[0]!.no}–EP{items.at(-1)!.no}・每頁 {PER_PAGE} 集
          </p>
        </section>
      )}
    </div>
  );
}
