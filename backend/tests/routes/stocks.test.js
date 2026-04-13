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
  getStockDrift: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: vi.fn(),
  })),
}));

import request from 'supertest';
import app from '../../src/app.js';
import { getStocksList, getStockDetail, getStockDrift } from '../../src/service.js';

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

describe('GET /api/stocks/:ticker/drift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with drift data', async () => {
    const fakeDrift = {
      timeline: [
        {
          episode: '400',
          title: 'Test Episode 400',
          uploadDate: '20230101',
          sentiment: 'bullish',
          reason: '業績強勁',
        },
        {
          episode: '461',
          title: 'Test Episode 461',
          uploadDate: '20240612',
          sentiment: 'bearish',
          reason: '估值過高',
        },
      ],
      driftAnalysis: '主持人對 NVDA 的看法從看多轉為看空...',
    };
    getStockDrift.mockResolvedValue(fakeDrift);

    const res = await request(app).get('/api/stocks/NVDA/drift');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeDrift);
    expect(getStockDrift).toHaveBeenCalledWith('NVDA');
  });

  it('returns 500 when service throws', async () => {
    getStockDrift.mockRejectedValue(new Error('OpenAI error'));

    const res = await request(app).get('/api/stocks/NVDA/drift');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
