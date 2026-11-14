import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, EpName } from '@/components/Badge';
import { EpisodeView } from '@/components/EpisodeView';
import { currentUser } from '@/lib/auth';
import { episodeIndex, getEpisode, parseEpisodeNo } from '@/lib/episodes';
import { formatDate, groupParagraphs, minutes } from '@/lib/format';
import { pageHref, pageOfIndex } from '@/lib/paging';
import { episodeDescription, episodeJsonLd, episodeTitle, SHARE_IMAGE, SITE_NAME } from '@/lib/seo';
import { stockIndex } from '@/lib/stock-pages';
import { sponsorHref, sponsorOf } from '@/lib/sponsors';
import { TOPIC_CATEGORIES, topicHref, topicOf } from '@/lib/topics';
import { stockFor, stockHref } from '@/lib/stocks';

type Props = {
  params: Promise<{ no: string }>;
  searchParams: Promise<{ t?: string; tab?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const no = parseEpisodeNo((await params).no);
  const ep = no === null ? null : await getEpisode(no);
  if (!ep) return { title: '找不到這一集' };
  const title = episodeTitle(ep.no, ep.summary.line);
  const description = episodeDescription(ep.summary);
  // ?t= and ?tab= show the same episode, so all of them point at the plain URL
  const url = `/ep/${ep.no}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      title,
      description,
      siteName: SITE_NAME,
      locale: 'zh_TW',
      publishedTime: ep.publishedAt,
      images: [SHARE_IMAGE],
    },
    twitter: { card: 'summary_large_image', title, description, images: [SHARE_IMAGE] },
  };
}

export default async function EpisodePage({ params, searchParams }: Props) {
  const no = parseEpisodeNo((await params).no);
  const ep = no === null ? null : await getEpisode(no);
  // layout.tsx already answered 404; this only covers an episode unpublished in between
  if (!ep) notFound();

  const sp = await searchParams;
  const t = sp.t !== undefined && /^\d{1,5}$/.test(sp.t) ? Math.min(Number(sp.t), ep.duration ?? Infinity) : null;
  // Back to the list page this episode appears on
  const back = pageHref(pageOfIndex(await episodeIndex(ep.no)));
  // Each stock's page with every episode that talks about it; null for the few without one
  const stocks = await stockIndex();
  const stockHrefs = ep.summary.stocks.map((s) => {
    const stock = stockFor(stocks, s.name, s.code);
    return stock ? stockHref(stock) : null;
  });
  // Each mention's topic page, for the categories that have them
  const mentionHrefs = ep.summary.mentions.map((m) => {
    const cat = TOPIC_CATEGORIES.find((c) => c.category === m.category); // 4 entries
    const t = cat && topicOf(m.category, m.name);
    return cat && t ? topicHref({ slug: t.slug, category: cat }) : null;
  });
  // Each ad chapter's sponsor page, from the chapter itself (the same rule the pages use)
  const sponsorHrefs = ep.summary.chapters.map((c) => {
    const s = c.ad ? sponsorOf(c) : null;
    return s ? sponsorHref(s) : null;
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: episodeJsonLd(ep) }} />
      <Link className="back" href={back}>
        ← 所有集數
      </Link>
      <div className="ep-head">
        <Badge title={ep.title} large />
        <div>
          <h1>
            EP{ep.no}
            <EpName title={ep.title} />
          </h1>
          <div className="meta">
            <span>{formatDate(ep.publishedAt)}</span>
            {ep.duration && <span>{minutes(ep.duration)} 分鐘</span>}
          </div>
          <p className="sum">{ep.summary.line}</p>
        </div>
      </div>
      <EpisodeView
        audioUrl={ep.audioUrl}
        duration={ep.duration ?? ep.segments.at(-1)?.end ?? 0}
        summary={ep.summary}
        stockHrefs={stockHrefs}
        sponsorHrefs={sponsorHrefs}
        mentionHrefs={mentionHrefs}
        paragraphs={groupParagraphs(ep.segments)}
        initialTab={sp.tab === 'tx' || t !== null ? 'tx' : 'summary'}
        initialT={t}
        seek={ep.seek}
        episode={ep.no}
        // The root layout reads the session for the header already
        signedIn={(await currentUser()) !== null}
      />
    </>
  );
}
