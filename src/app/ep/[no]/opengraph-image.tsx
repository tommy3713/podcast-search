import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { parseEpisodeNo } from '@/lib/episodes';
import { episodeImage, OG_SIZE, ogEpisode } from '@/lib/og/episode-image';
import { readDb } from '@/lib/server-db';

// Each episode's share image (src/lib/og/episode-image.tsx). It overrides the site's file-based
// one for /ep/<n>, which is still what a failure falls back to.
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = '股癌搜尋：這一集的重點（非官方粉絲網站）';

// A day in Cloudflare and browsers; a summary edit moves updated_at, which draws a new one here
// once the cached copy expires (social sites keep their own copy longer anyway)
const CACHE = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800';

// The site's image, read once (traced into the build by next.config.ts)
let siteImage: Promise<Buffer> | undefined;
const fallback = () => (siteImage ??= readFile(path.join(process.cwd(), 'src/app/opengraph-image.png')));

export default async function Image({ params }: { params: Promise<{ no: string }> }) {
  const no = parseEpisodeNo((await params).no);
  const ep = no === null ? null : ogEpisode(await readDb(), no);
  if (!ep) notFound();
  try {
    return new Response(await episodeImage(ep), { headers: { 'Content-Type': 'image/png', 'Cache-Control': CACHE } });
  } catch (err) {
    console.error(`share image for EP${ep.no}:`, err);
  }
  // The site's own, not cached long, so the next request tries again; without it, no image
  try {
    return new Response(new Uint8Array(await fallback()), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' } });
  } catch (err) {
    siteImage = undefined;
    console.error('the site share image:', err);
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
