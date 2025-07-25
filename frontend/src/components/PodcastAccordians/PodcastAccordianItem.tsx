import React, { FC } from 'react';
import {
  Accordion,
  AccordionItem,
  Avatar,
  Image,
  Button,
} from '@nextui-org/react';

interface PodcastAccordionItemProps {
  title: string;
  episode: string;
  uploadDate: string;
  highlights: Array<string>;
}

export const PodcastAccordionItem: FC<PodcastAccordionItemProps> = ({
  title,
  episode,
  uploadDate,
  highlights,
}) => {
  return (
    <AccordionItem
      key={episode}
      aria-label={title}
      startContent={
        <>
          <Image
            alt="nextui logo"
            width={80}
            src="https://i.scdn.co/image/a65a60aca98dcdf39f4dec11413197ccf29215b3"
          />
        </>
      }
      title={
        <div className="flex flex-1 flex-row justify-start items-center">
          <p className="text-sm me-2">EP: {episode}</p>
          <p className="text-md">{title}</p>
        </div>
      }
    >
      <div className="flex gap-y-3">
        {highlights.map((hightlight, i) => {
          const highlightedText = hightlight.replace(
            /{{HIGHLIGHT}}(.*?){{\/HIGHLIGHT}}/g,
            '<span style="color: red">$1</span>'
          );
          return (
            <p
              key={i}
              dangerouslySetInnerHTML={{ __html: highlightedText }}
            ></p>
          );
        })}
      </div>
    </AccordionItem>
  );
};
export default PodcastAccordionItem;
