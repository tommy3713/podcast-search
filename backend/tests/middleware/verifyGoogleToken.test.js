import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.hoisted(() => vi.fn());
const mockGetPayload = vi.hoisted(() => vi.fn());

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

import verifyGoogleToken from '../../src/middleware/verifyGoogleToken.js';

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

describe('verifyGoogleToken middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = createMockRes();
    next = vi.fn();
    vi.clearAllMocks();
  });

  it('returns 401 when Authorization header is missing', async () => {
    await verifyGoogleToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Missing or invalid Authorization header' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    req.headers.authorization = 'Token abc123';

    await verifyGoogleToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Missing or invalid Authorization header' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and sets req.user when token is valid', async () => {
    const fakePayload = { sub: '123', email: 'test@example.com' };
    mockGetPayload.mockReturnValue(fakePayload);
    mockVerifyIdToken.mockResolvedValue({ getPayload: mockGetPayload });
    req.headers.authorization = 'Bearer valid-token';

    await verifyGoogleToken(req, res, next);

    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid-token',
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    expect(req.user).toEqual(fakePayload);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 when verifyIdToken throws', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));
    req.headers.authorization = 'Bearer bad-token';

    await verifyGoogleToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized (invalid Google token)' });
    expect(next).not.toHaveBeenCalled();
  });
});
