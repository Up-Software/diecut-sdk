import { vi } from 'vitest';

/**
 * Builds a `Response`-compatible object to inject as `fetchImpl` in tests,
 * without depending on the real `fetch` implementation.
 */
export function fakeResponse(
  status: number,
  body: unknown,
  options: { headers?: Record<string, string>; invalidJson?: boolean; statusText?: string } = {},
): Response {
  const ok = status >= 200 && status < 300;
  const statusText = options.statusText ?? 'Status';
  return {
    ok,
    status,
    statusText,
    headers: {
      get: (name: string) => options.headers?.[name.toLowerCase()] ?? null,
    },
    json: async () => {
      if (options.invalidJson) {
        throw new SyntaxError('Unexpected end of JSON input');
      }
      return body;
    },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Creates a `fetch` mock (vi.fn) that always resolves with the given response. */
export function mockFetchOnce(
  status: number,
  body: unknown,
  options?: Parameters<typeof fakeResponse>[2],
) {
  return vi.fn().mockResolvedValue(fakeResponse(status, body, options));
}

/**
 * Creates a `fetch` mock that resolves a different response on each successive call, in the
 * given order. Useful for testing call chains (e.g. `dieline.create3DMockup()`), where each
 * request in the chain hits a different endpoint and expects a different response.
 */
export function mockFetchSequence(
  responses: Array<{ status: number; body: unknown; options?: Parameters<typeof fakeResponse>[2] }>,
) {
  const fn = vi.fn();
  for (const { status, body, options } of responses) {
    fn.mockResolvedValueOnce(fakeResponse(status, body, options));
  }
  return fn;
}
