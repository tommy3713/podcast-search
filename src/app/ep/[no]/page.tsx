import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, EpName } from '@/components/Badge';
import { EpisodeView } from '@/components/EpisodeView';
import { episodeIndex, getEpisode } from '@/lib/episodes';
import { formatDate, groupParagraphs, minutes } from '@/lib/format';
import { pageHref, pageOfIndex } from '@/lib/paging';
import { episodeDescription, episodeJsonLd, episodeTitle, SHARE_IMAGE, SITE_NAME } from '@/lib/seo';

type Props = {
  params: Promise<{ no: string }>;
  searchParams: Promise<{ t?: string; tab?: string }>;
};

function parseNo(raw: string): number | null {
  return /^\d{1,5}$/.test(raw) ? Number(raw) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const no = parseNo((await params).no);
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
  const no = parseNo((await params).no);
  const ep = no === null ? null : await getEpisode(no);
  if (!ep) notFound();

  const sp = await searchParams;
  const t = sp.t !== undefined && /^\d{1,5}$/.test(sp.t) ? Math.min(Number(sp.t), ep.duration ?? Infinity) : null;
  // Back to the list page this episode appears on
  const back = pageHref(pageOfIndex(await episodeIndex(ep.no)));

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
        paragraphs={groupParagraphs(ep.segments)}
        initialTab={sp.tab === 'tx' || t !== null ? 'tx' : 'summary'}
        initialT={t}
      />
    </>
  );
}
