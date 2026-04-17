import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.hoisted(() => vi.fn());

vi.mock('../../src/service.js', () => ({
  search: vi.fn(),
  getPodcasts: vi.fn(),
  getPodcastByPodcasterAndEpisode: vi.fn(),
  getPodcastChunks: vi.fn(),
  getPodcastTranscript: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

import request from 'supertest';
import app from '../../src/app.js';
import { getPodcastTranscript } from '../../src/service.js';

const validPayload = { sub: '123', email: 'user@example.com' };

function withAuth(req) {
  return req.set('Authorization', 'Bearer valid-token');
}

describe('GET /api/podcast/transcript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => validPayload,
    });
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .get('/api/podcast/transcript?podcaster=TestPodcaster&episode=EP001');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing or invalid Authorization header' });
  });

  it('returns 400 when podcaster is missing', async () => {
    const res = await withAuth(
      request(app).get('/api/podcast/transcript?episode=EP001')
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'podcaster is required' });
  });

  it('returns 400 when episode is missing', async () => {
    const res = await withAuth(
      request(app).get('/api/podcast/transcript?podcaster=TestPodcaster')
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'episode is required' });
  });

  it('returns 200 with transcript content', async () => {
    const fakeContent = '今天我們來聊聊美股的走勢...';
    getPodcastTranscript.mockResolvedValue(fakeContent);

    const res = await withAuth(
      request(app).get('/api/podcast/transcript?podcaster=TestPodcaster&episode=EP001')
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: fakeContent });
    expect(getPodcastTranscript).toHaveBeenCalledWith('TestPodcaster', 'EP001');
  });

  it('returns 404 when service returns null', async () => {
    getPodcastTranscript.mockResolvedValue(null);

    const res = await withAuth(
      request(app).get('/api/podcast/transcript?podcaster=TestPodcaster&episode=EP001')
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Transcript not found' });
  });

  it('returns 500 when service throws', async () => {
    getPodcastTranscript.mockRejectedValue(new Error('DB error'));

    const res = await withAuth(
      request(app).get('/api/podcast/transcript?podcaster=TestPodcaster&episode=EP001')
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
