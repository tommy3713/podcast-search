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
    <div className="w-full max-w-lg my-6 flex flex-row items-center justify-between gap-4">
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
