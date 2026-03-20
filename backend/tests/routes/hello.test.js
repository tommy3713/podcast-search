import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/service.js', () => ({
  search: vi.fn(),
  getPodcasts: vi.fn(),
  getPodcastByPodcasterAndEpisode: vi.fn(),
  getPodcastTranscriptByPodcasterAndEpisode: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: vi.fn(),
  })),
}));

import request from 'supertest';
import app from '../../src/app.js';

describe('GET /hello', () => {
  it('returns 200 with Hello World message', async () => {
    const res = await request(app).get('/hello');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Hello World!' });
  });
});
