'use client';
import { Input } from '@nextui-org/react';
import { Button } from '@nextui-org/button';
import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hook';
import { fetchSearchResults } from '@/features/searchSlice';
import { SearchIcon } from '@/icon/SearchIcon';
import { Image } from '@nextui-org/react';
export function SearchInput() {
  const [keyword, setkeyword] = useState('');
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
    <div className="w-[90%] sm:w-[40%] my-3 flex flex-row items-center justify-between">
      <Input
        label="Search"
        placeholder="Search for podcasts..."
        className=""
        onClear={() => setkeyword('')}
        // isClearables
        radius="lg"
        value={keyword}
        onKeyDown={onKeyDown}
        onChange={(event) => setkeyword(event.target.value)}
      ></Input>
      {/* <Button onClick={onClick} isLoading={status === 'loading'} isIconOnly>
          <Image src="/search.svg" alt="search icon" width={20} />
        </Button> */}
    </div>
  );
}
