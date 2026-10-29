// Untrusted text (transcripts, questions) is wrapped in tags for the model. Replacing
// < and > with full-width forms means the text can't open or close a tag.
export function escapeTags(s: string): string {
  return s.replace(/</g, '＜').replace(/>/g, '＞');
}
