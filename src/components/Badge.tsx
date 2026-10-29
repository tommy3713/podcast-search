import { graphemeCount, isEmojiTitle } from '@/lib/format';

const MIC_PATH = 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z';

// Emoji titles go in the badge; word titles get a mic icon and are shown by EpName instead
export function Badge({ title, large }: { title: string; large?: boolean }) {
  const size = large ? ' lg' : '';
  if (!isEmojiTitle(title)) {
    return (
      <span className={`emoji text${size}`} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d={MIC_PATH} />
        </svg>
      </span>
    );
  }
  return (
    <span className={`emoji${size}${graphemeCount(title) > 1 ? ' multi' : ''}`} aria-hidden="true">
      {title}
    </span>
  );
}

export function EpName({ title }: { title: string }) {
  return isEmojiTitle(title) ? null : <span className="ep-name">{title}</span>;
}
