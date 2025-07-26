'use client';
import { Input } from '@nextui-org/react';
import { Button } from '@nextui-org/react';
import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hook';
import { fetchSearchResults } from '@/features/searchSlice';

export function SearchInput() {
  const [keyword, setKeyword] = useState('');
  const dispatch = useAppDispatch();
  const status = useAppSelector((state) => state.search.status);

  const onClick = () => {
    dispatch(fetchSearchResults(keyword));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      onClick();
    }
  };

  return (
    <div className="my-6 w-[90%] max-w-lg flex flex-col sm:flex-row items-stretch gap-2 sm:items-center">
      <Input
        label="Search"
        placeholder="Search for podcasts..."
        className="flex-grow"
        radius="lg"
        value={keyword}
        onKeyDown={onKeyDown}
        onChange={(event) => setKeyword(event.target.value)}
        isClearable
      />
      <Button
        onClick={onClick}
        isLoading={status === 'loading'}
        className="bg-blue-500 text-white hover:bg-blue-600"
        radius="lg"
      >
        Search
      </Button>
    </div>
  );
}
