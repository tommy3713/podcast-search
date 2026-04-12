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
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: vi.fn(),
  })),
}));

import request from 'supertest';
import app from '../../src/app.js';
import { getStocksList, getStockDetail } from '../../src/service.js';

describe('GET /api/stocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with stocks list', async () => {
    const fakeStocks = [
      { ticker: 'NVDA', count: 5, firstDate: '20240101', lastDate: '20240612' },
      { ticker: 'TSLA', count: 3, firstDate: '20240201', lastDate: '20240501' },
    ];
    getStocksList.mockResolvedValue(fakeStocks);

    const res = await request(app).get('/api/stocks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeStocks);
    expect(getStocksList).toHaveBeenCalledOnce();
  });

  it('returns 500 when service throws', async () => {
    getStocksList.mockRejectedValue(new Error('Elasticsearch down'));

    const res = await request(app).get('/api/stocks');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

describe('GET /api/stocks/:ticker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with stock detail', async () => {
    const fakeDetail = {
      ticker: 'NVDA',
      episodes: [
        {
          episode: '461',
          fullTitle: '[20240612] EP461 Test',
          title: 'Test Episode',
          uploadDate: '20240612',
          sentiment: 'bullish',
        },
      ],
      sentimentCounts: { bullish: 1, bearish: 0, neutral: 0 },
    };
    getStockDetail.mockResolvedValue(fakeDetail);

    const res = await request(app).get('/api/stocks/NVDA');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeDetail);
    expect(getStockDetail).toHaveBeenCalledWith('NVDA');
  });

  it('returns 500 when service throws', async () => {
    getStockDetail.mockRejectedValue(new Error('Elasticsearch down'));

    const res = await request(app).get('/api/stocks/NVDA');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
