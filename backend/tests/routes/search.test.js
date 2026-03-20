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
import { search } from '../../src/service.js';

describe('GET /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with results array', async () => {
    const fakeResults = [
      {
        podcaster: 'TestPodcaster',
        title: 'Test Episode',
        uploadDate: '20231215',
        episode: 'EP001',
        fullTitle: 'TestPodcaster EP001',
        highlights: ['...keyword found here...'],
      },
    ];
    search.mockResolvedValue(fakeResults);

    const res = await request(app).get('/api/search?keyword=test');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeResults);
    expect(search).toHaveBeenCalledWith('test');
  });

  it('returns 500 plain text when service throws', async () => {
    search.mockRejectedValue(new Error('Elasticsearch down'));

    const res = await request(app).get('/api/search?keyword=test');

    expect(res.status).toBe(500);
    expect(res.text).toBe('Elasticsearch down');
  });

  it('returns 200 empty array for empty keyword', async () => {
    search.mockResolvedValue([]);

    const res = await request(app).get('/api/search?keyword=');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
