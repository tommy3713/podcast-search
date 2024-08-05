import Image from 'next/image';

import { SearchInput } from '@/components/SearchInput';
import { PodcastCard } from '@/components/PodcastCard';
import Hello from '@/components/Hello';
import PodcastCards from '@/components/PodcastCards';
import PodcastAccordians from '@/components/PodcastAccordians/PodcastAccordians';

export default function Home() {
  return (
    <div className="bg-white w-full flex flex-col items-center">
      <SearchInput />
      <PodcastAccordians />
      {/* <PodcastCards /> */}
      {/* <PodcastCard /> */}
      {/* <Hello /> */}
    </div>
  );
}
