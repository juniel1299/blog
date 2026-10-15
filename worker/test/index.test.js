import { describe, expect, test, vi } from 'vitest';
import worker from '../src/index.js';

const SECRET = 'postgres://user:hunter2@internal';

function envWith(first) {
  return {
    ALLOWED_ORIGINS: 'https://blog.example.com, http://localhost:5173',
    DB: { prepare: () => ({ first }) },
  };
}

function get(path, headers = {}) {
  return new Request(`https://api.test${path}`, { headers });
}

describe('health', () => {
  test('live returns 200 without touching DB', async () => {
    const first = vi.fn();
    const res = await worker.fetch(get('/health/live'), envWith(first));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'live' });
    expect(first).not.toHaveBeenCalled();
  });

  test('ready returns 200 when DB answers', async () => {
    const res = await worker.fetch(get('/health/ready'), envWith(async () => ({ 1: 1 })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ready' });
  });

  test('ready returns 503 and hides error details when DB fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await worker.fetch(
      get('/health/ready'),
      envWith(async () => {
        throw new Error(`connection failed ${SECRET}`);
      }),
    );
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(text).error.code).toBe('NOT_READY');
    expect(text).not.toContain('hunter2');
  });
});

describe('http', () => {
  test('unknown path returns structured 404 with request id', async () => {
    const res = await worker.fetch(get('/nope', { 'cf-ray': 'ray-1' }), envWith(vi.fn()));
    expect(res.status).toBe(404);
    expect(res.headers.get('x-request-id')).toBe('ray-1');
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found' },
      requestId: 'ray-1',
    });
  });

  test('CORS allows only listed origins', async () => {
    const allowed = await worker.fetch(
      get('/health/live', { origin: 'https://blog.example.com' }),
      envWith(vi.fn()),
    );
    const denied = await worker.fetch(
      get('/health/live', { origin: 'https://evil.example.com' }),
      envWith(vi.fn()),
    );
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://blog.example.com');
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});
