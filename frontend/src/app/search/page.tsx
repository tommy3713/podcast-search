import { SearchInput } from '@/components/SearchInput';
import PodcastAccordians from '@/components/PodcastAccordians/PodcastAccordians';

export default function Home() {
  return (
    <div className="w-full flex flex-col items-center pb-20 sm:pb-0">
      <SearchInput />
      <PodcastAccordians />
    </div>
  );
}
