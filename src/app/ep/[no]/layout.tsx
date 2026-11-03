import { notFound } from 'next/navigation';
import { episodeExists, parseEpisodeNo } from '@/lib/episodes';

// Checked here, above loading.tsx: once the skeleton has streamed, the status is already 200,
// so a notFound() in the page would no longer answer 404
export default async function EpisodeLayout({ children, params }: LayoutProps<'/ep/[no]'>) {
  const no = parseEpisodeNo((await params).no);
  if (no === null || !(await episodeExists(no))) notFound();
  return children;
}
