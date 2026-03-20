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
import { getPodcastTranscriptByPodcasterAndEpisode } from '../../src/service.js';

describe('GET /api/podcast/transcript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when podcaster is missing', async () => {
    const res = await request(app).get('/api/podcast/transcript?episode=EP001');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'fullTitle is required' });
  });

  it('returns 400 when episode is missing', async () => {
    const res = await request(app).get('/api/podcast/transcript?podcaster=TestPodcaster');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'episode is required' });
  });

  it('returns 200 with document when found', async () => {
    const fakeDoc = { content: 'Full transcript text here' };
    getPodcastTranscriptByPodcasterAndEpisode.mockResolvedValue(fakeDoc);

    const res = await request(app)
      .get('/api/podcast/transcript?podcaster=TestPodcaster&episode=EP001');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeDoc);
    expect(getPodcastTranscriptByPodcasterAndEpisode).toHaveBeenCalledWith(
      'TestPodcaster',
      'EP001'
    );
  });

  it('returns 404 when service returns null', async () => {
    getPodcastTranscriptByPodcasterAndEpisode.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/podcast/transcript?podcaster=TestPodcaster&episode=EP001');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Document not found' });
  });

  it('returns 500 when service throws', async () => {
    getPodcastTranscriptByPodcasterAndEpisode.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/podcast/transcript?podcaster=TestPodcaster&episode=EP001');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
