import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/service.js', () => ({
  search: vi.fn(),
  getPodcasts: vi.fn(),
  getPodcastByPodcasterAndEpisode: vi.fn(),
  getPodcastChunks: vi.fn(),
  askWithContext: vi.fn(),
  chatWithContext: vi.fn(),
  getThemesTimeline: vi.fn(),
  getStocksList: vi.fn(),
  getStockDetail: vi.fn(),
  getSentimentTimeline: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: vi.fn(),
  })),
}));

import request from 'supertest';
import app from '../../src/app.js';
import { getSentimentTimeline } from '../../src/service.js';

describe('GET /api/sentiment/timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with sentiment timeline array', async () => {
    const fakeSentiment = [
      {
        episode: '461',
        fullTitle: '[20240612] EP461 Test',
        title: 'Test Episode',
        uploadDate: '20240612',
        score: 0.7,
        label: '樂觀',
        reason: '主持人認為市場樂觀',
      },
      {
        episode: '462',
        fullTitle: '[20240619] EP462 Test2',
        title: 'Test Episode 2',
        uploadDate: '20240619',
        score: -0.4,
        label: '悲觀',
        reason: '主持人認為市場悲觀',
      },
    ];
    getSentimentTimeline.mockResolvedValue(fakeSentiment);

    const res = await request(app).get('/api/sentiment/timeline');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeSentiment);
    expect(getSentimentTimeline).toHaveBeenCalledOnce();
  });

  it('returns 500 when service throws', async () => {
    getSentimentTimeline.mockRejectedValue(new Error('Elasticsearch down'));

    const res = await request(app).get('/api/sentiment/timeline');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
