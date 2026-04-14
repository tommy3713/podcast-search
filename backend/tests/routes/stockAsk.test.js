import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.hoisted(() => vi.fn());

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
  askAboutStock: vi.fn(),
  getSentimentTimeline: vi.fn(),
  getGlossary: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

import request from 'supertest';
import app from '../../src/app.js';
import { askAboutStock } from '../../src/service.js';

const validPayload = { sub: '123', email: 'user@example.com' };

function withAuth(req) {
  return req.set('Authorization', 'Bearer valid-token');
}

describe('POST /api/stock/ask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => validPayload,
    });
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .post('/api/stock/ask')
      .send({ ticker: 'NVDA' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when ticker is missing', async () => {
    const res = await withAuth(
      request(app).post('/api/stock/ask').send({})
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ticker is required');
  });

  it('returns 400 when ticker exceeds 20 characters', async () => {
    const res = await withAuth(
      request(app)
        .post('/api/stock/ask')
        .send({ ticker: 'X'.repeat(21) })
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('股票代號長度不能超過 20 字元。');
  });

  it('streams SSE response with sources, content chunks, and DONE', async () => {
    askAboutStock.mockImplementation(
      async (ticker, onSources, onChunk, onDone) => {
        onSources([
          {
            podcaster: 'Gooaye',
            episode: '461',
            title: 'Test Episode',
            fullTitle: '[20240612] EP461 Test',
          },
        ]);
        onChunk('NVDA 看多，');
        onChunk('業績強勁。');
        onDone();
      }
    );

    const res = await withAuth(
      request(app).post('/api/stock/ask').send({ ticker: 'NVDA' })
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const body = res.text;
    expect(body).toContain('"sources"');
    expect(body).toContain('"NVDA 看多，"');
    expect(body).toContain('"業績強勁。"');
    expect(body).toContain('[DONE]');

    expect(askAboutStock).toHaveBeenCalledWith(
      'NVDA',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('returns 500 SSE error frame when askAboutStock throws', async () => {
    askAboutStock.mockRejectedValue(new Error('OpenAI error'));

    const res = await withAuth(
      request(app).post('/api/stock/ask').send({ ticker: 'NVDA' })
    );

    expect(res.status).toBe(200);
    const body = res.text;
    expect(body).toContain('"error"');
  });
});
