import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock('next-auth/react', () => ({
  getSession: mockGetSession,
}));

import { fetchWithAuth } from '@/utils/fetchWithAuth';

describe('fetchWithAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('throws when getSession returns null', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(fetchWithAuth('http://localhost:3000/api/test')).rejects.toThrow('尚未登入');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws when session has no id_token', async () => {
    mockGetSession.mockResolvedValue({ user: { email: 'test@example.com' } });

    await expect(fetchWithAuth('http://localhost:3000/api/test')).rejects.toThrow('尚未登入');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls fetch with Authorization Bearer token and Content-Type JSON', async () => {
    mockGetSession.mockResolvedValue({ id_token: 'my-token-123' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    await fetchWithAuth('http://localhost:3000/api/test');

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/api/test', {
      headers: {
        Authorization: 'Bearer my-token-123',
        'Content-Type': 'application/json',
      },
    });
  });

  it('merges existing headers without overwriting them', async () => {
    mockGetSession.mockResolvedValue({ id_token: 'my-token-456' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    await fetchWithAuth('http://localhost:3000/api/test', {
      headers: { 'X-Custom-Header': 'custom-value' },
    });

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/api/test', {
      headers: {
        'X-Custom-Header': 'custom-value',
        Authorization: 'Bearer my-token-456',
        'Content-Type': 'application/json',
      },
    });
  });

  it('forwards method and body options to fetch', async () => {
    mockGetSession.mockResolvedValue({ id_token: 'my-token-789' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    await fetchWithAuth('http://localhost:3000/api/test', {
      method: 'POST',
      body: JSON.stringify({ key: 'value' }),
    });

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/api/test', {
      method: 'POST',
      body: JSON.stringify({ key: 'value' }),
      headers: {
        Authorization: 'Bearer my-token-789',
        'Content-Type': 'application/json',
      },
    });
  });
});
