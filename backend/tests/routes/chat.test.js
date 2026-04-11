import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.hoisted(() => vi.fn());

vi.mock('../../src/service.js', () => ({
  search: vi.fn(),
  getPodcasts: vi.fn(),
  getPodcastByPodcasterAndEpisode: vi.fn(),
  getPodcastChunks: vi.fn(),
  askWithContext: vi.fn(),
  chatWithContext: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

import request from 'supertest';
import app from '../../src/app.js';
import { chatWithContext } from '../../src/service.js';

const validPayload = { sub: '123', email: 'user@example.com' };

function withAuth(req) {
  return req.set('Authorization', 'Bearer valid-token');
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => validPayload,
    });
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ question: 'test', messages: [] });

    expect(res.status).toBe(401);
  });

  it('returns 400 when question is missing', async () => {
    const res = await withAuth(
      request(app).post('/api/chat').send({ messages: [] })
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('question is required');
  });

  it('returns 400 when question exceeds 500 characters', async () => {
    const res = await withAuth(
      request(app)
        .post('/api/chat')
        .send({ question: 'x'.repeat(501), messages: [] })
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('問題長度不能超過 500 字元。');
  });

  it('returns 400 when messages is not an array', async () => {
    const res = await withAuth(
      request(app)
        .post('/api/chat')
        .send({ question: 'test', messages: 'not-an-array' })
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('messages must be an array');
  });

  it('streams SSE response with sources, content chunks, and DONE', async () => {
    chatWithContext.mockImplementation(
      async (q, msgs, onSources, onChunk, onDone) => {
        onSources([
          {
            podcaster: 'gooaye',
            episode: '461',
            title: 'Test Episode',
            fullTitle: '[20240612] EP461 Test',
          },
        ]);
        onChunk('說真的，');
        onChunk('這個問題很有趣。');
        onDone();
      }
    );

    const res = await withAuth(
      request(app)
        .post('/api/chat')
        .send({ question: '美股怎麼看？', messages: [] })
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const body = res.text;
    expect(body).toContain('"sources"');
    expect(body).toContain('"說真的，"');
    expect(body).toContain('"這個問題很有趣。"');
    expect(body).toContain('[DONE]');

    expect(chatWithContext).toHaveBeenCalledWith(
      '美股怎麼看？',
      [],
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
  });
});
