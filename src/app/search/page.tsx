import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { EpisodeLine } from '@/components/EpisodeRow';
import { Pager } from '@/components/Pager';
import { countEpisodes } from '@/lib/episodes';
import { MIN_TERM_CHARS, parseQuery, relatedPages, SEARCH_MAX_CHARS, SEARCH_MAX_TERMS, type SearchSort, siteSearch, type SnippetPart } from '@/lib/search';
import { readDb } from '@/lib/server-db';
import { stockData } from '@/lib/stock-pages';
import { formatTimestamp } from '@/lib/summary';

// Results differ per query; nothing here belongs in search results
export const metadata: Metadata = { title: '搜尋', robots: { index: false, follow: true } };

type Props = { searchParams: Promise<{ q?: string | string[]; sort?: string; page?: string }> };

// Shown before a search: each finds something on the live site
const EXAMPLES = ['台積電', '小島秀夫', 'Computex'];

const quoted = (terms: string[]) => terms.map((t) => `「${t}」`).join('');

function Parts({ parts }: { parts: SnippetPart[] }) {
  return parts.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>));
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = parseQuery(sp.q);
  const sort: SearchSort = sp.sort === 'new' ? 'new' : 'relevance';
  // The stock and topic pages a single word names; their index is read alongside
  const [db, count, pages] = await Promise.all([readDb(), countEpisodes(), query.terms.length === 1 ? stockData() : null]);
  const result = siteSearch(db, query.terms, sort, Number.parseInt(String(sp.page ?? '1'), 10) || 1);
  const related = pages ? relatedPages(pages, query.terms[0]!) : [];
  const href = (o: { sort?: SearchSort; page?: number }) => {
    const p = new URLSearchParams({ q: query.q });
    if ((o.sort ?? sort) === 'new') p.set('sort', 'new');
    if (o.page && o.page > 1) p.set('page', String(o.page));
    return `/search?${p}`;
  };

  return (
    <div className="search">
      <div className="ask-head">
        <div>
          <h1>搜尋所有集數</h1>
          <div className="fine">找 {count} 集的逐字稿和重點，點結果直接跳到那句話；不用登入，也不會用掉 AI 問答的題數</div>
        </div>
      </div>

      <Form action="/search" className="card search-form" role="search">
        <div className="field">
          <input
            name="q"
            type="search"
            defaultValue={query.q}
            maxLength={SEARCH_MAX_CHARS}
            placeholder="人名、公司、英文或記得的原話"
            aria-label="搜尋的字"
            autoComplete="off"
            enterKeyHint="search"
            autoFocus={!query.q}
          />
          <button className="btn primary" type="submit">
            搜尋
          </button>
        </div>
        {sort === 'new' && <input type="hidden" name="sort" value="new" />}
      </Form>

      {(query.short.length > 0 || query.extra.length > 0) && (
        <p className="notice" role="status">
          {query.short.length > 0 && `每個詞至少要 ${MIN_TERM_CHARS} 個字，沒有搜尋${quoted(query.short)}。`}
          {query.extra.length > 0 && `最多搜尋 ${SEARCH_MAX_TERMS} 個詞，沒有搜尋${quoted(query.extra)}。`}
        </p>
      )}

      {!query.terms.length && (
        <div className="card search-tips">
          <p style={{ margin: 0 }}>用空格分開幾個詞，會列出每個詞都有提到的集數。逐字稿是語音辨識，名稱可能寫成同音字：找不到時，會再用讀音找一次。</p>
          <div className="chips">
            <span className="fine" style={{ alignSelf: 'center' }}>
              試試：
            </span>
            {EXAMPLES.map((x) => (
              <Link key={x} className="chip" href={`/search?q=${encodeURIComponent(x)}`} prefetch={false}>
                {x}
              </Link>
            ))}
          </div>
        </div>
      )}

      {query.terms.length > 0 && result.total === 0 && (
        <div className="card search-tips">
          <p style={{ margin: 0 }}>
            找不到{query.terms.length > 1 ? '同時提到' : '提到'}
            {quoted(query.terms)}的集數。可以換個說法、少用幾個詞，或用
            <Link href={`/ask?q=${encodeURIComponent(query.q)}`}>AI 問答</Link>
            描述你記得的內容。
          </p>
        </div>
      )}

      {related.length > 0 && (
        <div className="chips search-related">
          <span className="fine" style={{ alignSelf: 'center' }}>
            相關頁面：
          </span>
          {related.map((r) => (
            <Link key={r.href} className="chip" href={r.href} prefetch={false}>
              <span className="fine">{r.kind}</span> {r.name}
            </Link>
          ))}
        </div>
      )}

      {result.total > 0 && (
        <>
          <div className="search-head">
            <span>
              找到 <b>{result.total}</b> 集
            </span>
            <nav className="search-sort" aria-label="排序">
              <Link href={href({ sort: 'relevance' })} aria-current={sort === 'relevance' ? 'true' : undefined}>
                相關
              </Link>
              <Link href={href({ sort: 'new' })} aria-current={sort === 'new' ? 'true' : undefined}>
                最新
              </Link>
            </nav>
          </div>
          {result.soundTerms.length > 0 && (
            <p className="notice" role="status">
              逐字稿裡沒有{quoted(result.soundTerms)}，以下是讀音相同的段落（語音辨識常把名稱寫成同音字）。
            </p>
          )}
          {/* No prefetch: each link is a different ?t=&hl= on the dynamic /ep route, about 100 a page */}
          <div className="search-results">
            {result.episodes.map((e) => (
              <article key={e.no} className="card sr-ep">
                <Link className="sr-title" href={`/ep/${e.no}`} prefetch={false}>
                  <EpisodeLine ep={e} />
                </Link>
                <div className="d">{e.line}</div>
                {e.point && (
                  <p className="sr-point">
                    <span className="pill info">重點</span>
                    <Link className="ts" href={`/ep/${e.no}?t=${e.point.t}`} prefetch={false}>
                      {formatTimestamp(e.point.t)}
                    </Link>
                    <span>
                      <Parts parts={e.point.parts} />
                    </span>
                  </p>
                )}
                {e.snippets.length > 0 && (
                  <ul className="sr-snips" data-nosnippet>
                    {e.snippets.map((s, i) => (
                      <li key={i}>
                        <Link className="ts" href={`/ep/${e.no}?t=${s.t}&hl=${encodeURIComponent(s.hl)}`} prefetch={false}>
                          {formatTimestamp(s.t)}
                        </Link>
                        <span>
                          <Parts parts={s.parts} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {e.more && (
                  <Link className="sr-more" href={`/ep/${e.no}?t=${e.more.t}&hl=${encodeURIComponent(e.more.hl)}`} prefetch={false}>
                    還有 {e.more.count} 處 →
                  </Link>
                )}
              </article>
            ))}
          </div>
          {result.pages > 1 && <Pager page={result.page} total={result.pages} href={(n) => href({ page: n })} name="搜尋結果分頁" />}
        </>
      )}
    </div>
  );
}
