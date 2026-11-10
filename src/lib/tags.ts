// Untrusted text (transcripts, questions) is wrapped in tags for the model. Replacing
// < and > with full-width forms means the text can't open or close a tag.
export function escapeTags(s: string): string {
  return s.replace(/</g, '＜').replace(/>/g, '＞');
}

// For text that sits next to a source's [n] label: square brackets become full-width,
// so a transcript that happens to say "[3]" can't pass for another source's label
export function escapeSourceText(s: string): string {
  return escapeTags(s).replace(/\[/g, '［').replace(/\]/g, '］');
}
