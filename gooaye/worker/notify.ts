// Telegram notifications. Without a bot token (local dev) messages go to stdout.
export async function notify(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log(`[notify] ${text}`);
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error(`[notify] Telegram ${res.status}: ${await res.text()}`);
  } catch (err) {
    // A notification failure must never fail the pipeline
    console.error('[notify] Telegram error', err);
  }
}
