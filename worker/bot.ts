import { ASK_LOG_DAYS } from '@/lib/ask/quota.ts';
import type { DB } from '@/lib/db.ts';
import { ACTION_LABEL, checkAction, type EpisodeAction, enqueue, poll, queueState, runEpisodeAction } from './actions.ts';
import {
  backfillStatus,
  cancelBackfill,
  describePlan,
  getBackfill,
  MAX_BACKFILL,
  planBackfill,
  runBackfill,
  startBackfill,
} from './backfill.ts';
import { estimateCost } from './config.ts';
import { retryButtons, STEP_LABEL, usd } from './pipeline.ts';
import { type EpisodeRow, getEpisode, recentEpisodes } from './repo.ts';
import { fetchFeed, parseFeed } from './rss.ts';
import { askStats, formatAsk, formatQuestions, formatStats, recentQuestions, unanswered } from './stats.ts';
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
  { command: 'stats', description: '問答統計，預設 7 天，例如 /stats 30' },
  { command: 'questions', description: '最近的問答，點編號看回答，例如 /questions 30' },
  { command: 'backfill', description: '往前補 N 集舊集數，例如 /backfill 20；不加數字看進度，/backfill stop 停止' },
];

const HELP = `股癌搜尋 worker\n${COMMANDS.map((c) => `/${c.command}　${c.description}`).join('\n')}`;

// Commands typed while the worker was down are dropped after this long; buttons on old
// messages still work, since pressing one is always deliberate.
const MAX_COMMAND_AGE_MS = 10 * 60_000;

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

// The confirm button under /backfill N: "backfill:<n>:<first episode of the plan>". Pressing it
// plans again and starts only if the plan still begins there, so a late press can't start
// something other than what was shown
export function parseBackfillCallback(data: string): { n: number; first: number } | null {
  const m = /^backfill:(\d{1,3}):(\d{1,5})$/.exec(data);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= MAX_BACKFILL ? { n, first: Number(m[2]) } : null;
}

// Buttons under /questions: "ask:<ask_log id>"
export function parseAskCallback(data: string): number | null {
  const m = /^ask:(\d{1,9})$/.exec(data);
  return m ? Number(m[1]) : null;
}

// The ids as buttons, five to a row
export function questionButtons(ids: number[]): Button[][] {
  const rows: Button[][] = [];
  for (let i = 0; i < ids.length; i += 5) rows.push(ids.slice(i, i + 5).map((id) => ({ text: `#${id}`, data: `ask:${id}` })));
  return rows;
}

async function handle(db: DB, u: Update): Promise<void> {
  if (u.callback_query) {
    const q = u.callback_query;
    if (!isOwnerChat(q.message?.chat.id)) return;
    const askId = q.data ? parseAskCallback(q.data) : null;
    if (askId !== null) {
      await answerCallback(q.id, '');
      return sendMessage(formatAsk(db, askId));
    }
    const confirm = q.data ? parseBackfillCallback(q.data) : null;
    if (confirm) {
      if (getBackfill(db)) return answerCallback(q.id, '已經在補集數了，用 /backfill 看進度');
      const feed = await fetchFeed().catch(() => null);
      if (!feed) return answerCallback(q.id, '讀取 RSS 失敗，請稍後再按');
      const plan = planBackfill(db, confirm.n, parseFeed(feed));
      if (typeof plan === 'string') return answerCallback(q.id, plan);
      if (plan.episodes[0]?.episodeNo !== confirm.first) return answerCallback(q.id, '要補的集數變了，請重新下 /backfill');
      startBackfill(db, plan);
      await answerCallback(q.id, '開始補集數');
      if (q.message) await closeButtons(q.message, '⏳ 開始補集數，完成後會通知').catch(() => {});
      void runBackfill(db);
      return;
    }
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
    case 'stats': {
      // Older ask_log rows are already purged
      const days = Math.min(ASK_LOG_DAYS, Math.max(1, Number(c.arg) || 7));
      const since = new Date(Date.now() - days * 86_400_000);
      return sendMessage(formatStats(`最近 ${days} 天問答`, askStats(db, since), unanswered(db, since)));
    }
    case 'questions': {
      const rows = recentQuestions(db, Math.min(30, Math.max(1, Number(c.arg) || 10)));
      return sendMessage(formatQuestions(rows), questionButtons(rows.map((r) => r.id)));
    }
    case 'poll':
      await sendMessage('🔍 檢查 RSS 中…');
      enqueue('檢查 RSS', () => poll(db))
        .then(({ found, latestInFeed }) => {
          if (!found.length) return sendMessage(`沒有新集數，RSS 最新是 EP${latestInFeed}`);
        })
        .catch((err) => sendMessage(`❌ 檢查 RSS 失敗：${err instanceof Error ? err.message : err}`));
      return;
    case 'backfill':
      return handleBackfill(db, c.arg);
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

// No number: progress (and resume one an error interrupted). A number: a plan to confirm with a button.
async function handleBackfill(db: DB, arg: string | undefined): Promise<void> {
  if (arg === undefined) {
    void runBackfill(db);
    return sendMessage(backfillStatus(db));
  }
  if (arg.toLowerCase() === 'stop') return sendMessage(cancelBackfill(db) ?? '目前沒有在補集數');
  const n = /^\d{1,4}$/.test(arg) ? Number(arg) : 0;
  if (n < 1 || n > MAX_BACKFILL) return sendMessage(`請給 1 到 ${MAX_BACKFILL} 的集數，例如 /backfill 20`);
  if (getBackfill(db)) return sendMessage(`已經在補集數了\n${backfillStatus(db)}`);
  let plan;
  try {
    plan = planBackfill(db, n, parseFeed(await fetchFeed()));
  } catch (err) {
    return sendMessage(`❌ 讀取 RSS 失敗：${err instanceof Error ? err.message : err}`);
  }
  if (typeof plan === 'string') return sendMessage(plan);
  await sendMessage(`${describePlan(plan)}\n每集做完會停兩分鐘，新集數和指令可以插隊`, [
    [{ text: `✅ 開始補 ${plan.episodes.length} 集`, data: `backfill:${n}:${plan.episodes[0]!.episodeNo}` }],
  ]);
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
