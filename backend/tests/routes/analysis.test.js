import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.hoisted(() => vi.fn());

vi.mock('../../src/service.js', () => ({
  getCompanyAnalysisList: vi.fn(),
  getCompanyAnalysis: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

import request from 'supertest';
import app from '../../src/app.js';
import { getCompanyAnalysisList, getCompanyAnalysis } from '../../src/service.js';

const validPayload = { sub: '123', email: 'user@example.com' };

function withAuth(req) {
  return req.set('Authorization', 'Bearer valid-token');
}

const fakeAnalysis = {
  key: 'NVDA',
  company: '輝達（NVIDIA / NVDA / NV）',
  range: '1y',
  generated_at: '2026-10-23T16:00:00',
  episodes: [{ episode: 'EP464', date: '20240622', fullTitle: '[20240622] EP464', reason_count: 1 }],
  threads: [
    {
      id: 'T1',
      label: '輝達毛利率',
      history: [
        {
          episode: 'EP464',
          date: '20240622',
          relation: '新增',
          reason: '主持人認為輝達毛利率會被慢慢侵蝕。',
          reference: '輝達的毛利會慢慢被侵蝕',
          focus: '主角',
          why: '',
        },
      ],
    },
  ],
};

describe('GET /api/analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with the list of analyzed companies without auth', async () => {
    const list = [{ key: 'NVDA', company: '輝達', range: '1y', episode_count: 48, thread_count: 120 }];
    getCompanyAnalysisList.mockResolvedValue(list);

    const res = await request(app).get('/api/analysis');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(list);
  });

  it('returns 500 when service throws', async () => {
    getCompanyAnalysisList.mockRejectedValue(new Error('ES down'));

    const res = await request(app).get('/api/analysis');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe('GET /api/analysis/:key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => validPayload,
    });
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/analysis/NVDA');

    expect(res.status).toBe(401);
    expect(getCompanyAnalysis).not.toHaveBeenCalled();
  });

  it('returns 200 with the analysis', async () => {
    getCompanyAnalysis.mockResolvedValue(fakeAnalysis);

    const res = await withAuth(request(app).get('/api/analysis/NVDA'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeAnalysis);
    expect(getCompanyAnalysis).toHaveBeenCalledWith('NVDA');
  });

  it('returns 404 when the company has not been analyzed', async () => {
    getCompanyAnalysis.mockResolvedValue(null);

    const res = await withAuth(request(app).get('/api/analysis/TSM'));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Analysis not found' });
  });

  it('returns 500 when service throws', async () => {
    getCompanyAnalysis.mockRejectedValue(new Error('ES down'));

    const res = await withAuth(request(app).get('/api/analysis/NVDA'));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
