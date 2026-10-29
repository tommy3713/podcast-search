import OpenAI from 'openai';
import { EMBEDDING_MODEL, llmCost } from './config.ts';

const BATCH = 100;

export async function embed(texts: string[]): Promise<{ vectors: number[][]; costUsd: number }> {
  const client = new OpenAI();
  const vectors: number[][] = [];
  let tokens = 0;
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: texts.slice(i, i + BATCH) });
    for (const d of res.data.sort((a, b) => a.index - b.index)) vectors.push(d.embedding);
    tokens += res.usage.total_tokens;
  }
  return { vectors, costUsd: llmCost(EMBEDDING_MODEL, tokens, 0, 0) };
}
