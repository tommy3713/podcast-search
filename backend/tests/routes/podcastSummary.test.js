import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.hoisted(() => vi.fn());

vi.mock('../../src/service.js', () => ({
  search: vi.fn(),
  getPodcasts: vi.fn(),
  getPodcastByPodcasterAndEpisode: vi.fn(),
  getPodcastTranscriptByPodcasterAndEpisode: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

import request from 'supertest';
import app from '../../src/app.js';
import { getPodcastByPodcasterAndEpisode } from '../../src/service.js';

const validPayload = { sub: '123', email: 'user@example.com' };

function withAuth(req) {
  return req.set('Authorization', 'Bearer valid-token');
}

describe('GET /api/podcast/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => validPayload,
    });
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .get('/api/podcast/summary?podcaster=TestPodcaster&episode=EP001');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing or invalid Authorization header' });
  });

  it('returns 400 when podcaster is missing (auth present)', async () => {
    const res = await withAuth(
      request(app).get('/api/podcast/summary?episode=EP001')
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'fullTitle is required' });
  });

  it('returns 400 when episode is missing (auth present)', async () => {
    const res = await withAuth(
      request(app).get('/api/podcast/summary?podcaster=TestPodcaster')
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'episode is required' });
  });

  it('returns 200 with document when found (auth present)', async () => {
    const fakeDoc = {
      _id: 'abc',
      podcaster: 'TestPodcaster',
      episode: 'EP001',
      title: 'Test',
      note: 'Summary note',
    };
    getPodcastByPodcasterAndEpisode.mockResolvedValue(fakeDoc);

    const res = await withAuth(
      request(app).get('/api/podcast/summary?podcaster=TestPodcaster&episode=EP001')
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ podcaster: 'TestPodcaster', episode: 'EP001' });
    expect(getPodcastByPodcasterAndEpisode).toHaveBeenCalledWith(
      'TestPodcaster',
      'EP001'
    );
  });

  it('returns 404 when service returns null (auth present)', async () => {
    getPodcastByPodcasterAndEpisode.mockResolvedValue(null);

    const res = await withAuth(
      request(app).get('/api/podcast/summary?podcaster=TestPodcaster&episode=EP001')
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Document not found' });
  });

  it('returns 500 when service throws (auth present)', async () => {
    getPodcastByPodcasterAndEpisode.mockRejectedValue(new Error('DB error'));

    const res = await withAuth(
      request(app).get('/api/podcast/summary?podcaster=TestPodcaster&episode=EP001')
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
