'use client';
import React from 'react';
import { Accordion, AccordionItem, Avatar, Image } from '@nextui-org/react';
import { useAppSelector } from '../../app/hook';
import PodcastAccordionItem from './PodcastAccordianItem';

export default function PodcastAccordians() {
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
                {result.highlights.map((hightlight) => {
                  const highlightedText = hightlight.replace(
                    /{{HIGHLIGHT}}(.*?){{\/HIGHLIGHT}}/g,
                    '<span style="color: red">$1</span>'
                  );
                  return (
                    <p
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
