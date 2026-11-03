import { notFound } from 'next/navigation';
import { episodeExists, parseEpisodeNo } from '@/lib/episodes';

// Checked here, above loading.tsx: once the skeleton has streamed, the status is already 200,
// so a notFound() in the page would no longer answer 404
type Props = { children: React.ReactNode; params: Promise<{ no: string }> };

export default async function EpisodeLayout({ children, params }: Props) {
  const no = parseEpisodeNo((await params).no);
  if (no === null || !(await episodeExists(no))) notFound();
  return children;
}
