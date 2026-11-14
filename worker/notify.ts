import { type Button, sendMessage, telegramEnabled } from './telegram.ts';

// Without Telegram configured (local dev) messages go to stdout. Never throws; false when
// Telegram didn't take the message, for callers that would send it again later.
export async function notify(text: string, buttons: Button[][] = []): Promise<boolean> {
  if (!telegramEnabled()) {
    const labels = buttons.flat().map((b) => `[${b.text}]`).join(' ');
    console.log(`[notify] ${text}${labels ? `\n${labels}` : ''}`);
    return true;
  }
  try {
    await sendMessage(text, buttons);
    return true;
  } catch (err) {
    // A notification failure must never fail the pipeline
    console.error('[notify]', err instanceof Error ? err.message : err);
    return false;
  }
}
