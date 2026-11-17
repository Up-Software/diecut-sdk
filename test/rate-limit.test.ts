import { describe, it, expect, vi } from 'vitest';
import { ApiHttpClient } from '../src/http-client';
import { DielinesClient } from '../src/dielines/client';
import { DimensionsClient } from '../src/dimensions/client';
import { DiecutApiError, DiecutRateLimitError, mapErrorResponse } from '../src/errors';
import { mapDieline } from '../src/dielines/mappers';
import { fakeResponse, mockFetchOnce } from './helpers';

/** Fake clock: `sleep` advances the time instead of waiting, and every wait is recorded. */
function makeClock(start = 1_000_000) {
  const clock = {
    time: start,
    sleeps: [] as number[],
    now: () => clock.time,
    sleep: async (ms: number) => {
      clock.sleeps.push(ms);
      const target = clock.time + ms;
      await Promise.resolve();
      clock.time = Math.max(clock.time, target);
    },
  };
  return clock;
}

function makeHttp(
  fetchImpl: typeof fetch,
  clock: ReturnType<typeof makeClock>,
  extra: Partial<ConstructorParameters<typeof ApiHttpClient>[0]> = {},
) {
  return new ApiHttpClient({
    baseUrl: 'https://api.example.com',
    apiKey: 'k',
    apiVersionHeader: 'Dielines-Api-Version',
    fetchImpl,
    sleep: clock.sleep,
    now: clock.now,
    ...extra,
  });
}

const get = { method: 'GET', path: '/x' } as const;

describe('client-side rate limiter', () => {
  it('spaces sequential requests by minRequestIntervalMs (default 1000)', async () => {
    const clock = makeClock();
    const starts: number[] = [];
    const fetchImpl = vi.fn(async () => {
      starts.push(clock.time);
      return fakeResponse(200, {});
    }) as unknown as typeof fetch;
    const http = makeHttp(fetchImpl, clock);

    await http.request(get);
    await http.request(get);
    await http.request(get);

    expect(starts[1] - starts[0]).toBe(1000);
    expect(starts[2] - starts[1]).toBe(1000);
    expect(clock.sleeps).toEqual([1000, 1000]);
  });

  it('does not wait when enough time has already passed', async () => {
    const clock = makeClock();
    const http = makeHttp(mockFetchOnce(200, {}), clock);
    await http.request(get);
    clock.time += 5000;
    await http.request(get);
    expect(clock.sleeps).toEqual([]);
  });

  it('queues concurrent requests instead of firing them together', async () => {
    // The clock stands still while the three calls reserve their slots synchronously, so each
    // queued request is told to wait one more interval than the previous one.
    const sleeps: number[] = [];
    const http = makeHttp(mockFetchOnce(200, {}), makeClock(), {
      minRequestIntervalMs: 500,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await Promise.all([http.request(get), http.request(get), http.request(get)]);

    expect(sleeps).toEqual([500, 1000]);
  });

  it('is disabled with minRequestIntervalMs: 0', async () => {
    const clock = makeClock();
    const http = makeHttp(mockFetchOnce(200, {}), clock, { minRequestIntervalMs: 0 });
    await Promise.all([http.request(get), http.request(get), http.request(get)]);
    expect(clock.sleeps).toEqual([]);
  });

  it('really waits with the default timer-based sleep', async () => {
    const fetchImpl = mockFetchOnce(200, {});
    const http = new ApiHttpClient({
      baseUrl: 'https://api.example.com',
      apiKey: 'k',
      apiVersionHeader: 'Dielines-Api-Version',
      fetchImpl,
      minRequestIntervalMs: 30,
    });
    const started = Date.now();
    await http.request(get);
    await http.request(get);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});

describe('option validation', () => {
  const base = { baseUrl: 'https://api.example.com', apiKey: 'k', apiVersionHeader: 'H' };

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects minRequestIntervalMs = %s',
    (value) => {
      expect(() => new ApiHttpClient({ ...base, minRequestIntervalMs: value })).toThrow(
        /"minRequestIntervalMs" must be a non-negative finite number/,
      );
    },
  );

  it.each([-1, 1.5, Number.NaN])('rejects maxRetries = %s', (value) => {
    expect(() => new ApiHttpClient({ ...base, maxRetries: value })).toThrow(
      /"maxRetries" must be a non-negative integer/,
    );
  });

  it('validates at construction in both public clients', () => {
    expect(() => new DielinesClient({ apiKey: 'k', minRequestIntervalMs: -5 })).toThrow(
      /minRequestIntervalMs/,
    );
    expect(() => new DimensionsClient({ apiKey: 'dim_k', maxRetries: 0.5 })).toThrow(/maxRetries/);
  });

  it('accepts the boundary values 0', () => {
    expect(
      () => new DielinesClient({ apiKey: 'k', minRequestIntervalMs: 0, maxRetries: 0 }),
    ).not.toThrow();
  });
});

describe('retry on 429', () => {
  function sequence(...responses: Response[]) {
    const fn = vi.fn();
    for (const response of responses) {
      fn.mockResolvedValueOnce(response);
    }
    return fn as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  }

  it('retries a 429 and returns the later success, honoring Retry-After in seconds', async () => {
    const clock = makeClock();
    const fetchImpl = sequence(
      fakeResponse(429, { message: 'slow down' }, { headers: { 'retry-after': '3' } }),
      fakeResponse(200, { ok: true }),
    );
    const http = makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0 });

    await expect(http.request(get)).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toEqual([3000]);
  });

  it('does not wait for a Retry-After longer than 60 s and throws right away', async () => {
    const clock = makeClock();
    const fetchImpl = sequence(
      fakeResponse(429, {}, { headers: { 'retry-after': '3600' } }),
      fakeResponse(200, {}),
    );
    const error = await makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0 })
      .request(get)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DiecutRateLimitError);
    expect((error as DiecutRateLimitError).retryAfterMs).toBe(3_600_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('releases the body of a retried 429 response', async () => {
    const clock = makeClock();
    const cancel = vi.fn(async () => undefined);
    const throttled = Object.assign(fakeResponse(429, {}), { body: { cancel } });
    const fetchImpl = sequence(throttled, fakeResponse(200, {}));

    await makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0 }).request(get);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('still retries when releasing the body fails', async () => {
    const clock = makeClock();
    const cancel = vi.fn(async () => {
      throw new Error('stream already closed');
    });
    const throttled = Object.assign(fakeResponse(429, {}), { body: { cancel } });
    const fetchImpl = sequence(throttled, fakeResponse(200, { ok: true }));

    await expect(
      makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0 }).request(get),
    ).resolves.toEqual({ ok: true });
  });

  it('honors Retry-After given as an HTTP-date', async () => {
    const clock = makeClock(Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'));
    const fetchImpl = sequence(
      fakeResponse(429, {}, { headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:05 GMT' } }),
      fakeResponse(200, {}),
    );
    await makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0 }).request(get);
    expect(clock.sleeps).toEqual([5000]);
  });

  it('uses 0 ms when the Retry-After date is already in the past', async () => {
    const clock = makeClock(Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'));
    const fetchImpl = sequence(
      fakeResponse(429, {}, { headers: { 'retry-after': 'Wed, 21 Oct 2026 07:00:00 GMT' } }),
      fakeResponse(200, {}),
    );
    await makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0 }).request(get);
    expect(clock.sleeps).toEqual([0]);
  });

  it.each([undefined, 'soon', '  ', '-4'])(
    'falls back to exponential backoff when Retry-After is %j',
    async (header) => {
      const clock = makeClock();
      const headers = header === undefined ? undefined : { 'retry-after': header };
      const fetchImpl = sequence(
        fakeResponse(429, {}, { headers }),
        fakeResponse(429, {}, { headers }),
        fakeResponse(200, {}),
      );
      await makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0 }).request(get);
      expect(clock.sleeps).toEqual([1000, 2000]);
    },
  );

  it('throws DiecutRateLimitError with retryAfterMs when 429 persists after retries', async () => {
    const clock = makeClock();
    const headers = { 'retry-after': '2', 'x-request-id': 'req-1' };
    const fetchImpl = sequence(
      fakeResponse(429, { message: 'Too many' }, { headers }),
      fakeResponse(429, { message: 'Too many' }, { headers }),
      fakeResponse(429, { message: 'Too many' }, { headers }),
    );
    const http = makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0 });

    const error = await http.request(get).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiecutRateLimitError);
    expect(error).toBeInstanceOf(DiecutApiError);
    const rateLimit = error as DiecutRateLimitError;
    expect(rateLimit.name).toBe('DiecutRateLimitError');
    expect(rateLimit.status).toBe(429);
    expect(rateLimit.retryAfterMs).toBe(2000);
    expect(rateLimit.requestId).toBe('req-1');
    expect(rateLimit.body).toEqual({ message: 'Too many' });
    expect(rateLimit.message).toBe('Too many');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('leaves retryAfterMs undefined when the header is absent', async () => {
    const clock = makeClock();
    const fetchImpl = mockFetchOnce(429, { message: 'Too many' });
    const error = await makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0, maxRetries: 1 })
      .request(get)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiecutRateLimitError);
    expect((error as DiecutRateLimitError).retryAfterMs).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry with maxRetries: 0', async () => {
    const clock = makeClock();
    const fetchImpl = mockFetchOnce(429, {}, { headers: { 'retry-after': '1' } });
    const error = await makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0, maxRetries: 0 })
      .request(get)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiecutRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it.each([400, 401, 404, 500, 503])('does not retry status %i', async (status) => {
    const clock = makeClock();
    const fetchImpl = mockFetchOnce(status, { message: 'nope' });
    await expect(
      makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0 }).request(get),
    ).rejects.toBeInstanceOf(DiecutApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry network errors', async () => {
    const clock = makeClock();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      makeHttp(fetchImpl as unknown as typeof fetch, clock, { minRequestIntervalMs: 0 }).request(
        get,
      ),
    ).rejects.toThrow('fetch failed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('makes retries go through the rate limiter', async () => {
    const clock = makeClock();
    const starts: number[] = [];
    const responses = [
      fakeResponse(429, {}, { headers: { 'retry-after': '0' } }),
      fakeResponse(200, {}),
    ];
    const fetchImpl = vi.fn(async () => {
      starts.push(clock.time);
      return responses.shift() as Response;
    }) as unknown as typeof fetch;
    const http = makeHttp(fetchImpl, clock);

    await http.request(get);

    expect(starts[1] - starts[0]).toBe(1000);
  });

  it('gives every attempt its own timeout and clears the timers', async () => {
    const clock = makeClock();
    vi.useFakeTimers();
    try {
      const fetchImpl = sequence(fakeResponse(429, {}), fakeResponse(200, {}));
      await makeHttp(fetchImpl, clock, { minRequestIntervalMs: 0 }).request(get);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DiecutRateLimitError mapping', () => {
  it('maps 429 to DiecutRateLimitError', () => {
    const error = mapErrorResponse(429, { message: 'x' }, 'rid', 1500);
    expect(error).toBeInstanceOf(DiecutRateLimitError);
    expect((error as DiecutRateLimitError).retryAfterMs).toBe(1500);
    expect(error.requestId).toBe('rid');
  });
});

describe('partAreas mapping', () => {
  const client = new DielinesClient({ apiKey: 'k', minRequestIntervalMs: 0 });

  it('converts documented string values to numbers and keeps the unit', () => {
    const dieline = mapDieline(client, {
      id: 'd1',
      part_areas: {
        'inner-tray': { value: '96574.47', unit: 'mm2' },
        'sleeve-cover': { value: '83868.55', unit: 'mm2' },
      },
    });
    expect(dieline.partAreas).toEqual({
      'inner-tray': { value: 96574.47, unit: 'mm2' },
      'sleeve-cover': { value: 83868.55, unit: 'mm2' },
    });
  });

  it('is undefined when part_areas is absent', () => {
    expect(mapDieline(client, { id: 'd1' }).partAreas).toBeUndefined();
  });
});
