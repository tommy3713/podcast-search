import type { DB } from '@/lib/db.ts';
import { ACTION_LABEL, checkAction, type EpisodeAction, enqueue, poll, queueState, runEpisodeAction } from './actions.ts';
import { estimateCost } from './config.ts';
import { retryButtons, STEP_LABEL } from './pipeline.ts';
import { type EpisodeRow, getEpisode, recentEpisodes } from './repo.ts';
import {
  answerCallback,
  type Button,
  closeButtons,
  getUpdates,
  isOwnerChat,
  sendMessage,
  setCommands,
  telegramEnabled,
  type Update,
} from './telegram.ts';

const COMMANDS = [
  { command: 'status', description: '最近集數的狀態和費用' },
  { command: 'poll', description: '馬上檢查一次 RSS' },
  { command: 'retry', description: '從失敗的步驟重試，例如 /retry 710' },
  { command: 'resummarize', description: '只重新整理重點，例如 /resummarize 709' },
  { command: 'retranscribe', description: '重新轉錄並整理，例如 /retranscribe 709' },
];

const HELP = `股癌搜尋 worker\n${COMMANDS.map((c) => `/${c.command}　${c.description}`).join('\n')}`;

// Commands typed while the worker was down are dropped after this long; buttons on old
// messages still work, since pressing one is always deliberate.
const MAX_COMMAND_AGE_MS = 10 * 60_000;

const usd = (n: number) => `US$${n.toFixed(2)}`;

export async function runBot(db: DB): Promise<void> {
  if (!telegramEnabled()) return;
  await setCommands(COMMANDS).catch((err) => console.error('[bot] setMyCommands', err.message));
  console.log('[bot] listening for Telegram commands');
  let offset = 0;
  for (;;) {
    try {
      for (const u of await getUpdates(offset)) {
        offset = u.update_id + 1;
        await handle(db, u).catch((err) => console.error('[bot]', err instanceof Error ? err.message : err));
      }
    } catch (err) {
      console.error('[bot] getUpdates', err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

export function parseCommand(text: string): { cmd: string; arg: string | undefined } | null {
  // "/retry@MyBot 710" in groups, "/retry 710" in a private chat
  const m = /^\/([a-z]+)(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec(text.trim());
  return m ? { cmd: m[1]!.toLowerCase(), arg: m[2] } : null;
}

export function parseCallback(data: string): { action: EpisodeAction; episodeNo: number } | null {
  const m = /^(retry|resummarize|retranscribe):(\d{1,5})$/.exec(data);
  return m ? { action: m[1] as EpisodeAction, episodeNo: Number(m[2]) } : null;
}

async function handle(db: DB, u: Update): Promise<void> {
  if (u.callback_query) {
    const q = u.callback_query;
    if (!isOwnerChat(q.message?.chat.id)) return;
    const parsed = q.data ? parseCallback(q.data) : null;
    if (!parsed) return answerCallback(q.id, '看不懂這個按鈕');
    const reason = checkAction(db, parsed.action, parsed.episodeNo);
    if (reason) return answerCallback(q.id, reason);
    await answerCallback(q.id, '已排入');
    if (q.message) await closeButtons(q.message, `⏳ 已排入：${ACTION_LABEL[parsed.action]}`).catch(() => {});
    queueAction(db, parsed.action, parsed.episodeNo);
    return;
  }

  const msg = u.message;
  if (!msg?.text || !isOwnerChat(msg.chat.id)) return;
  if (Date.now() - msg.date * 1000 > MAX_COMMAND_AGE_MS) return;
  const c = parseCommand(msg.text);
  if (!c) return sendMessage(HELP);

  switch (c.cmd) {
    case 'status':
      return sendStatus(db);
    case 'poll':
      await sendMessage('🔍 檢查 RSS 中…');
      enqueue('檢查 RSS', () => poll(db))
        .then(({ found, latestInFeed }) => {
          if (!found.length) return sendMessage(`沒有新集數，RSS 最新是 EP${latestInFeed}`);
        })
        .catch((err) => sendMessage(`❌ 檢查 RSS 失敗：${err instanceof Error ? err.message : err}`));
      return;
    case 'retry':
    case 'resummarize':
    case 'retranscribe': {
      const no = c.arg && /^\d{1,5}$/.test(c.arg) ? Number(c.arg) : null;
      if (no === null) return sendMessage(`請加上集數，例如 /${c.cmd} 710`);
      const reason = checkAction(db, c.cmd, no);
      if (reason) return sendMessage(reason);
      const row = getEpisode(db, no);
      const step = c.cmd === 'retranscribe' ? 'transcribe' : c.cmd === 'resummarize' ? 'summarize' : (row?.failed_step ?? 'transcribe');
      await sendMessage(`⏳ 已排入：EP${no} ${ACTION_LABEL[c.cmd]}（約 ${usd(estimateCost(step, row?.duration ?? 3000))}）`);
      queueAction(db, c.cmd, no);
      return;
    }
    default:
      return sendMessage(HELP);
  }
}

// The pipeline sends its own success/failure message when the job finishes
function queueAction(db: DB, action: EpisodeAction, episodeNo: number): void {
  enqueue(`EP${episodeNo} ${ACTION_LABEL[action]}`, () => runEpisodeAction(db, action, episodeNo)).catch((err) =>
    sendMessage(`❌ EP${episodeNo} ${ACTION_LABEL[action]}失敗：${err instanceof Error ? err.message : err}`),
  );
}

export function statusLine(e: EpisodeRow): string {
  const cost = e.cost_usd ? `・${usd(e.cost_usd)}` : '';
  const step = e.failed_step ? STEP_LABEL[e.failed_step] : '';
  switch (e.status) {
    case 'done':
      return `EP${e.episode_no} ${e.title} ✅ 上線${step ? `（最近一次重跑在「${step}」失敗）` : ''}${cost}`;
    case 'failed':
      return `EP${e.episode_no} ${e.title} ❌ 「${step}」失敗 ${e.retries} 次${cost}`;
    case 'transcribing':
      return `EP${e.episode_no} ${e.title} 🎙 轉錄中${cost}`;
    case 'summarizing':
      return `EP${e.episode_no} ${e.title} 📝 整理重點中${cost}`;
    default:
      return `EP${e.episode_no} ${e.title} ⏸ 等待處理`;
  }
}

async function sendStatus(db: DB): Promise<void> {
  const rows = recentEpisodes(db, 8);
  const { running, waiting } = queueState();
  const lines = [
    '📋 最近集數',
    ...rows.map(statusLine),
    running ? `\n⏳ 處理中：${running}${waiting ? `，後面還有 ${waiting} 件` : ''}` : '\n目前沒有在處理的工作',
  ];
  // Buttons for anything that needs attention
  const buttons: Button[][] = rows
    .filter((e) => e.failed_step)
    .flatMap((e) => retryButtons(e, e.failed_step).map((row) => row.map((b) => ({ ...b, text: `EP${e.episode_no} ${b.text}` }))));
  await sendMessage(lines.join('\n'), buttons.slice(0, 9));
}
