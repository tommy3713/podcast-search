import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { getPodcasts } from '../../src/service.js';

const fakePodcasts = [
  {
    _id: 'abc',
    title: 'Episode 1',
    uploadDate: '20231215',
    episode: 'EP001',
    fullTitle: 'Podcaster EP001',
    podcaster: 'Podcaster',
  },
];

describe('GET /api/podcast/all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls getPodcasts with default page=1 limit=10 when no params given', async () => {
    getPodcasts.mockResolvedValue(fakePodcasts);

    const res = await request(app).get('/api/podcast/all');

    expect(res.status).toBe(200);
    expect(getPodcasts).toHaveBeenCalledWith(1, 10);
    expect(res.body).toEqual(fakePodcasts);
  });

  it('passes page and limit query params to getPodcasts', async () => {
    getPodcasts.mockResolvedValue(fakePodcasts);

    const res = await request(app).get('/api/podcast/all?page=2&limit=5');

    expect(res.status).toBe(200);
    expect(getPodcasts).toHaveBeenCalledWith(2, 5);
  });

  it('returns 500 when service throws', async () => {
    getPodcasts.mockRejectedValue(new Error('DB error'));

    const res = await request(app).get('/api/podcast/all');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
