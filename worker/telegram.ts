// Telegram Bot API: notifications, and buttons/commands for retrying episodes.
// Only the chat in TELEGRAM_CHAT_ID can control the worker.

export type Button = { text: string; data: string };

export type Update = {
  update_id: number;
  message?: { message_id: number; date: number; chat: { id: number }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number }; text?: string };
  };
};

function config(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return token && chatId ? { token, chatId } : null;
}

export function telegramEnabled(): boolean {
  return config() !== null;
}

export function isOwnerChat(chatId: number | undefined): boolean {
  const c = config();
  return !!c && chatId !== undefined && String(chatId) === c.chatId;
}

async function api<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const c = config();
  if (!c) throw new Error('Telegram is not configured');
  const res = await fetch(`https://api.telegram.org/bot${c.token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  // The token is part of the URL, so never include the URL in errors
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  return json.result;
}

const keyboard = (rows: Button[][]) => ({
  inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))),
});

// Plain text only (no parse_mode): episode titles and error messages go in unescaped
export async function sendMessage(text: string, buttons: Button[][] = []): Promise<void> {
  const c = config();
  if (!c) return;
  await api('sendMessage', {
    chat_id: c.chatId,
    text,
    link_preview_options: { is_disabled: true },
    ...(buttons.length ? { reply_markup: keyboard(buttons) } : {}),
  });
}

export async function answerCallback(id: string, text: string): Promise<void> {
  await api('answerCallbackQuery', { callback_query_id: id, text });
}

// Replace the pressed message's buttons with a note, so the same action can't be queued twice
export async function closeButtons(message: { message_id: number; chat: { id: number }; text?: string }, note: string): Promise<void> {
  await api('editMessageText', { chat_id: message.chat.id, message_id: message.message_id, text: `${message.text ?? ''}\n\n${note}` });
}

export async function getUpdates(offset: number): Promise<Update[]> {
  return api<Update[]>('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 70_000);
}

export async function setCommands(commands: { command: string; description: string }[]): Promise<void> {
  await api('setMyCommands', { commands });
}
