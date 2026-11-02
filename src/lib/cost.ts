// USD per million tokens, shared by the worker (summaries, embeddings) and the web (Q&A).
// Verify against the providers' pricing pages when changing models.
const PER_M_TOKENS: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5.5': { input: 5, cached: 0.5, output: 30 },
  'gpt-5.4': { input: 2.5, cached: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'text-embedding-3-small': { input: 0.02, cached: 0.02, output: 0 },
};

// What one Q&A request used, as the agent counts it. Only finished model turns report
// usage, so a request that times out or is aborted mid-turn is under-counted: its cost is
// a lower bound.
export type AskUsage = { inputTokens: number; cachedTokens: number; outputTokens: number; embeddingTokens: number };

export function askCost(model: string, u: AskUsage): number {
  return llmCost(model, u.inputTokens, u.cachedTokens, u.outputTokens) + llmCost('text-embedding-3-small', u.embeddingTokens, 0, 0);
}

// `input` includes the cached tokens, as the APIs report it
export function llmCost(model: string, input: number, cached: number, output: number): number {
  const p = PER_M_TOKENS[model];
  if (!p) return 0;
  return ((input - cached) * p.input + cached * p.cached + output * p.output) / 1e6;
}
