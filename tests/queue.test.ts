import { afterEach, describe, expect, it } from 'vitest';
import { enqueue, onQueueChange, queueState } from '../worker/actions.ts';

afterEach(() => onQueueChange(null));

describe('job queue', () => {
  it('runs jobs one at a time and reports each start and end', async () => {
    const seen: (string | null)[] = [];
    onQueueChange(() => seen.push(queueState().running));
    const order: string[] = [];
    let release!: () => void;
    const first = enqueue('first', () => new Promise<void>((r) => (release = r)).then(() => order.push('first')));
    const second = enqueue('second', async () => order.push('second'));
    await Promise.resolve();
    expect(queueState()).toMatchObject({ running: 'first', waiting: 1 });
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
    // Reported when each job is queued, starts and ends; the deploy script waits for nothing running or waiting
    expect(seen).toEqual([null, null, 'first', null, 'second', null]);
    expect(queueState()).toEqual({ running: null, runningSince: null, waiting: 0 });
  });

  it('reports the end of a job that fails', async () => {
    const seen: (string | null)[] = [];
    onQueueChange(() => seen.push(queueState().running));
    await expect(enqueue('boom', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(seen).toEqual([null, 'boom', null]);
  });
});
