export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptParagraph {
  start: number;
  text: string;
}

// Whisper segments are only a few seconds long; merge them into paragraphs of at
// least `minSeconds` so the transcript reads as prose with a timestamp per paragraph.
export const groupSegments = (
  segments: TranscriptSegment[],
  minSeconds = 30
): TranscriptParagraph[] => {
  const paragraphs: TranscriptParagraph[] = [];
  let current: TranscriptParagraph | null = null;
  for (const seg of segments) {
    if (!current || seg.start - current.start >= minSeconds) {
      current = { start: seg.start, text: '' };
      paragraphs.push(current);
    }
    current.text += seg.text;
  }
  return paragraphs;
};

// 75 → "1:15", 3725 → "1:02:05"
export const formatTimestamp = (seconds: number): string => {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
