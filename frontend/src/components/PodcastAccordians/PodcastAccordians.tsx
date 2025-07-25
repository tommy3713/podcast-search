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
import Link from 'next/link';

export default function PodcastAccordians() {
  const results = useAppSelector((state) => state.search.results);
  const status = useAppSelector((state) => state.search.status);
  const error = useAppSelector((state) => state.search.error);

  return (
    <div className="flex flex-col items-center gap-y-6 w-[90%] sm:w-3/4">
      {status === 'failed' && (
        <p className="text-red-500 font-semibold">Error: {error}</p>
      )}
      {status === 'idle' && (
        <p className="text-gray-600 font-medium">Please enter a keyword</p>
      )}
      {status === 'succeeded' && (
        <Accordion variant="splitted" className="!px-0 w-full">
          {results.map((result) => (
            <AccordionItem
              key={result.episode}
              aria-label={result.title}
              startContent={
                <Avatar
                  src="https://i.scdn.co/image/a65a60aca98dcdf39f4dec11413197ccf29215b3"
                  alt="Podcast Cover"
                  size="lg"
                  className="mr-4"
                />
              }
              title={
                <div className="flex flex-col">
                  <p className="text-sm text-gray-500">
                    Episode: {result.episode}
                  </p>
                  <p className="text-md font-semibold text-gray-800">
                    {result.title}
                  </p>
                </div>
              }
            >
              <div className="flex flex-col gap-y-4 mb-4">
                <Link href={`/summary/${result.podcaster}/${result.episode}`}>
                  <Button
                    color="primary"
                    className="w-full sm:w-auto"
                    radius="lg"
                  >
                    View AI Notes
                  </Button>
                </Link>
                <div className="space-y-2">
                  {result.highlights.map((highlight, index) => {
                    return (
                      <p key={index} className="text-gray-700">
                        {highlight
                          .split(/({{HIGHLIGHT}}.*?{{\/HIGHLIGHT}})/g)
                          .map((part, i) => {
                            const match = part.match(
                              /{{HIGHLIGHT}}(.*?){{\/HIGHLIGHT}}/
                            );
                            if (match) {
                              return (
                                <span key={i} className="text-red-500">
                                  {match[1]}
                                </span>
                              );
                            }
                            return <span key={i}>{part}</span>;
                          })}
                      </p>
                    );
                  })}
                </div>
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
