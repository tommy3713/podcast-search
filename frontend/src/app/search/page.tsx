import { SearchInput } from '@/components/SearchInput';
import PodcastAccordians from '@/components/PodcastAccordians/PodcastAccordians';

export default function Home() {
  return (
    <div className="w-full flex flex-col items-center px-4 pb-24 sm:pb-8 md:px-6">
      <SearchInput />
      <PodcastAccordians />
    </div>
  );
}
