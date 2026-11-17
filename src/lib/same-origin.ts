// The checks a JSON POST from this site's own pages must pass (a cookie-authenticated request
// another site could otherwise send): a JSON content type, which a plain cross-site form can't
// send, and an Origin naming this host when there is one. An unparseable Origin ("null", sent
// from sandboxed frames and some redirects) is refused too, rather than throwing.
// The response to send back, or null when the request may go on.
export function refuseCrossSite(req: Request): Response | null {
  if (!req.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: '格式錯誤' }, { status: 415 });
  const origin = req.headers.get('origin');
  if (origin === null) return null;
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch {
    // "null" and other junk
  }
  return host !== null && host === req.headers.get('host') ? null : Response.json({ error: '來源不符' }, { status: 403 });
}
