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
  getGlossary: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: vi.fn(),
  })),
}));

import request from 'supertest';
import app from '../../src/app.js';
import { getGlossary } from '../../src/service.js';

describe('GET /api/glossary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with glossary terms array', async () => {
    const fakeGlossary = [
      {
        term: 'EPS 修正',
        count: 3,
        occurrences: [
          {
            episode: '461',
            fullTitle: '[20240612] EP461 Test',
            title: 'Test Episode',
            uploadDate: '20240612',
            quote: '主持人提到 EPS 修正是很重要的指標',
          },
        ],
      },
      {
        term: '均值回歸',
        count: 2,
        occurrences: [
          {
            episode: '450',
            fullTitle: '[20240501] EP450 Test2',
            title: 'Test Episode 2',
            uploadDate: '20240501',
            quote: '均值回歸的概念在長期投資中很重要',
          },
        ],
      },
    ];
    getGlossary.mockResolvedValue(fakeGlossary);

    const res = await request(app).get('/api/glossary');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeGlossary);
    expect(getGlossary).toHaveBeenCalledOnce();
  });

  it('returns 200 with empty array when no glossary terms exist', async () => {
    getGlossary.mockResolvedValue([]);

    const res = await request(app).get('/api/glossary');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 500 when service throws', async () => {
    getGlossary.mockRejectedValue(new Error('Elasticsearch down'));

    const res = await request(app).get('/api/glossary');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});
