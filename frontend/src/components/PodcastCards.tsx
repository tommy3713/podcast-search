'use client';
import { useAppSelector } from '../app/hook';
import { PodcastCard } from './PodcastCard';
import { Accordion, AccordionItem } from '@nextui-org/react';
export default function PodcastCards() {
  const results = useAppSelector((state) => state.search.results);
  const status = useAppSelector((state) => state.search.status);
  const error = useAppSelector((state) => state.search.error);

  return (
    <div className="flex flex-col items-center gap-y-3">
      {status === 'failed' && <p className="text-black">Error: {error}</p>}
      {status === 'idle' && (
        <p className="text-black">Please enter a keyword</p>
      )}
      {status === 'succeeded' &&
        results.map((result) => (
          <PodcastCard key={result.episode} {...result} />
        ))}
    </div>
  );
}
