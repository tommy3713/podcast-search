import { OUTCOME_LABEL, type Outcome } from '@/lib/ask/log';

// Bits the list and a question's page share

const PILL: Record<Outcome, string> = {
  answered: 'pill info',
  no_source: 'pill warn',
  moderated: 'pill warn',
  quota: 'pill flat',
  timeout: 'pill warn',
  aborted: 'pill flat',
  error: 'pill warn',
};

export function OutcomePill({ outcome }: { outcome: string | null }) {
  // Rows from before outcomes were recorded have none
  if (!outcome || !(outcome in OUTCOME_LABEL)) return <span className="pill flat">{outcome ?? '未記錄'}</span>;
  return <span className={PILL[outcome as Outcome]}>{OUTCOME_LABEL[outcome as Outcome]}</span>;
}

export function AskFacts({ cited, ms, costUsd }: { cited: number | null; ms: number | null; costUsd: number | null }) {
  const facts = [
    cited !== null ? `引用 ${cited}` : null,
    ms !== null ? `${(ms / 1000).toFixed(1)} 秒` : null,
    costUsd !== null ? `US$${costUsd.toFixed(4)}` : null,
  ].filter(Boolean);
  return facts.length ? <span className="muted">{facts.join('・')}</span> : null;
}
