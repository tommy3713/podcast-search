import { readDb } from '@/lib/server-db';
import { excerptAt } from '@/lib/stock-pages';

// The transcript from just before a timestamp, for 看逐字稿 on a stock's page. Nothing here
// that the episode's own page doesn't already show, so it needs no login.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const [ep, t] = [q.get('ep') ?? '', q.get('t') ?? ''];
  if (!/^\d{1,5}$/.test(ep) || !/^\d{1,5}$/.test(t)) return Response.json({ error: 'bad request' }, { status: 400 });
  const excerpt = excerptAt(await readDb(), Number(ep), Number(t));
  if (!excerpt) return Response.json({ error: 'not found' }, { status: 404 });
  // A re-transcribed episode changes it, rarely
  return Response.json(excerpt, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
