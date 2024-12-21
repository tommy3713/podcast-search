import {
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Divider,
  Link,
  Image,
  Button,
} from '@nextui-org/react';

interface PodcastCardProps {
  title: string;
  episode: string;
  uploadDate: string;
  highlights: Array<string>;
}

export function PodcastCard({
  title,
  episode,
  uploadDate,
  highlights,
}: Readonly<PodcastCardProps>) {
  return (
    <Card className="w-3/4">
      <CardHeader className="flex gap-3">
        <Image
          alt="nextui logo"
          width={80}
          src="https://i.scdn.co/image/a65a60aca98dcdf39f4dec11413197ccf29215b3"
        />
        <div className="flex flex-1 flex-row justify-start items-center">
          <p className="text-sm me-2">EP: {episode}</p>
          <p className="text-md">{title}</p>
        </div>
      </CardHeader>
      <Divider />

      <CardBody className="flex gap-y-3">
        {highlights.map((hightlight) => {
          const highlightedText = hightlight.replace(
            /{{HIGHLIGHT}}(.*?){{\/HIGHLIGHT}}/g,
            '<span style="color: red">$1</span>'
          );
          return <p dangerouslySetInnerHTML={{ __html: highlightedText }}></p>;
        })}
      </CardBody>
      <Divider />
      <CardFooter>
        <Link
          isExternal
          showAnchorIcon
          href="https://github.com/nextui-org/nextui"
        >
          Not yet implemented
        </Link>
      </CardFooter>
    </Card>
  );
}
