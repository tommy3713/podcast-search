'use client';
import React from 'react';
import {
  Accordion,
  AccordionItem,
  Avatar,
  Image,
  Button,
} from '@nextui-org/react';
import { useAppSelector } from '../../app/hook';
import { useRouter } from 'next/router';
import Link from 'next/link';

export default function PodcastAccordians() {
  // const router = useRouter();
  const results = useAppSelector((state) => state.search.results);
  const status = useAppSelector((state) => state.search.status);
  const error = useAppSelector((state) => state.search.error);

  return (
    <div className="flex flex-col items-center gap-y-3 w-[90%] sm:w-3/4">
      {status === 'failed' && <p className="text-black">Error: {error}</p>}
      {status === 'idle' && (
        <p className="text-black">Please enter a keyword</p>
      )}
      {status === 'succeeded' && (
        <Accordion variant="splitted" className="!px-0">
          {results.map((result) => (
            <AccordionItem
              key={result.episode}
              aria-label={result.title}
              startContent={
                <Image
                  alt="nextui logo"
                  width={80}
                  src="https://i.scdn.co/image/a65a60aca98dcdf39f4dec11413197ccf29215b3"
                />
              }
              title={
                <div className="flex flex-1 flex-row justify-start items-center">
                  <p className="text-sm me-2">EP: {result.episode}</p>
                  <p className="text-md">{result.title}</p>
                </div>
              }
            >
              <div className="flex flex-col gap-y-3 mb-3">
                <Button color="primary" className="w-1/12">
                  <Link href={`/summary/${result.podcaster}/${result.episode}`}>
                    AI筆記整理
                  </Link>
                </Button>
                {result.highlights.map((hightlight, index) => {
                  const highlightedText = hightlight.replace(
                    /{{HIGHLIGHT}}(.*?){{\/HIGHLIGHT}}/g,
                    '<span style="color: red">$1</span>'
                  );
                  return (
                    <p
                      key={index}
                      className="text-black"
                      dangerouslySetInnerHTML={{ __html: highlightedText }}
                    ></p>
                  );
                })}
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
