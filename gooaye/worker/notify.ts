import { type Button, sendMessage, telegramEnabled } from './telegram.ts';

// Without Telegram configured (local dev) messages go to stdout.
export async function notify(text: string, buttons: Button[][] = []): Promise<void> {
  if (!telegramEnabled()) {
    const labels = buttons.flat().map((b) => `[${b.text}]`).join(' ');
    console.log(`[notify] ${text}${labels ? `\n${labels}` : ''}`);
    return;
  }
  try {
    await sendMessage(text, buttons);
  } catch (err) {
    // A notification failure must never fail the pipeline
    console.error('[notify]', err instanceof Error ? err.message : err);
  }
}
