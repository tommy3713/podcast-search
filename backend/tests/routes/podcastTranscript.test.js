import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.hoisted(() => vi.fn());

vi.mock('../../src/service.js', () => ({
  search: vi.fn(),
  getPodcasts: vi.fn(),
  getPodcastByPodcasterAndEpisode: vi.fn(),
  getPodcastChunks: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

import request from 'supertest';
import app from '../../src/app.js';
import { getPodcastChunks } from '../../src/service.js';

const validPayload = { sub: '123', email: 'user@example.com' };

function withAuth(req) {
  return req.set('Authorization', 'Bearer valid-token');
}

describe('GET /api/podcast/chunks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => validPayload,
    });
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .get('/api/podcast/chunks?podcaster=TestPodcaster&episode=EP001');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing or invalid Authorization header' });
  });

  it('returns 400 when podcaster is missing', async () => {
    const res = await withAuth(
      request(app).get('/api/podcast/chunks?episode=EP001')
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'podcaster is required' });
  });

  it('returns 400 when episode is missing', async () => {
    const res = await withAuth(
      request(app).get('/api/podcast/chunks?podcaster=TestPodcaster')
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'episode is required' });
  });

  it('returns 200 with paginated chunks', async () => {
    const fakeResult = {
      chunks: [
        { chunk_index: 0, chunk_text: 'First chunk text' },
        { chunk_index: 1, chunk_text: 'Second chunk text' },
      ],
      total: 42,
      page: 1,
      hasMore: true,
    };
    getPodcastChunks.mockResolvedValue(fakeResult);

    const res = await withAuth(
      request(app).get('/api/podcast/chunks?podcaster=TestPodcaster&episode=EP001&page=1')
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeResult);
    expect(getPodcastChunks).toHaveBeenCalledWith('TestPodcaster', 'EP001', 1);
  });

  it('defaults to page 1 when page param is omitted', async () => {
    getPodcastChunks.mockResolvedValue({ chunks: [], total: 0, page: 1, hasMore: false });

    await withAuth(
      request(app).get('/api/podcast/chunks?podcaster=TestPodcaster&episode=EP001')
    );

    expect(getPodcastChunks).toHaveBeenCalledWith('TestPodcaster', 'EP001', 1);
  });

  it('returns 500 when service throws', async () => {
    getPodcastChunks.mockRejectedValue(new Error('DB error'));

    const res = await withAuth(
      request(app).get('/api/podcast/chunks?podcaster=TestPodcaster&episode=EP001')
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
