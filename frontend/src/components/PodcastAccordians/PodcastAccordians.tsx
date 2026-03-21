'use client';
import React from 'react';
import { useAppSelector } from '../../app/hook';
import Link from 'next/link';

export default function PodcastAccordians() {
  const results = useAppSelector((state) => state.search.results);
  const status = useAppSelector((state) => state.search.status);
  const error = useAppSelector((state) => state.search.error);

  return (
    <div className="flex flex-col gap-y-3 w-[90%] sm:w-3/4">
      {status === 'failed' && (
        <p className="text-red-500 font-semibold">Error: {error}</p>
      )}
      {status === 'idle' && (
        <p className="text-gray-600 font-medium">Please enter a keyword</p>
      )}
      {status === 'succeeded' &&
        results.map((result) => (
          <Link
            key={result.episode}
            href={`/summary/${result.podcaster}/${result.episode}`}
          >
            <div className="bg-white border border-[#e8e6dd] rounded-lg hover:border-[#b8b6ac] transition-colors p-4 cursor-pointer">
              <div className="flex items-center gap-x-2 mb-2">
                <span className="bg-[#f0efe8] text-[#666] text-xs font-medium px-2 py-0.5 rounded shrink-0">
                  EP.{result.episode}
                </span>
                <p className="text-sm font-semibold text-gray-800 leading-snug">
                  {result.title}
                </p>
              </div>
              <div className="space-y-1">
                {result.highlights.map((highlight, index) => (
                  <p key={index} className="text-sm text-gray-600 leading-relaxed">
                    {highlight
                      .split(/({{HIGHLIGHT}}.*?{{\/HIGHLIGHT}})/g)
                      .map((part, i) => {
                        const match = part.match(/{{HIGHLIGHT}}(.*?){{\/HIGHLIGHT}}/);
                        if (match) {
                          return (
                            <mark
                              key={i}
                              className="bg-[#fbf3db] text-[#7a5800] rounded-sm px-0.5"
                            >
                              {match[1]}
                            </mark>
                          );
                        }
                        return <span key={i}>{part}</span>;
                      })}
                  </p>
                ))}
              </div>
            </div>
          </Link>
        ))}
    </div>
  );
}
