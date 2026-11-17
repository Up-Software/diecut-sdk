import { mapErrorResponse } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiHttpClientOptions {
  /** Base URL without a trailing slash, e.g. `https://api.diecuttemplates.com`. */
  baseUrl: string;
  /** API key for the corresponding product (Dielines or Dieline Dimensions). */
  apiKey: string;
  /** Name of the API version header, e.g. `Dielines-Api-Version` or `Dimensions-Api-Version`. */
  apiVersionHeader: string;
  /** Value of the API version header. Defaults to `"1.0"`. */
  apiVersion?: string;
  /** Timeout in milliseconds for each request. Defaults to `30000`. */
  timeoutMs?: number;
  /** `fetch` implementation to use (allows injecting a mock in tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * Minimum time in milliseconds between the start of two requests made through this client
   * instance. Defaults to `1000` (the provider allows 1 request per second); `0` disables the
   * client-side rate limiter.
   */
  minRequestIntervalMs?: number;
  /**
   * Maximum number of retries when the API answers `429 Too Many Requests`. Defaults to `2`;
   * `0` disables retries. Only 429 responses are retried.
   */
  maxRetries?: number;
  /** Waits for the given number of milliseconds. Defaults to `setTimeout` (injectable in tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Current time in milliseconds since the epoch. Defaults to `Date.now` (injectable in tests). */
  now?: () => number;
}

/** Backoff used for the first retry when a 429 response carries no usable `Retry-After`. */
const BASE_BACKOFF_MS = 1000;

/**
 * Longest `Retry-After` the client waits for on its own. A longer delay is not retried: the
 * {@link DiecutRateLimitError} is thrown right away with `retryAfterMs`, so the caller decides.
 */
const MAX_RETRY_DELAY_MS = 60_000;

export interface RequestOptions {
  method: HttpMethod;
  /** Path relative to `baseUrl`; must start with `/`. */
  path: string;
  /** Query params; `undefined` values are omitted. */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON body. When present, it is serialized and `Content-Type: application/json` is added. */
  json?: unknown;
  /**
   * Multipart body. When present, `Content-Type` is NOT set manually: `fetch`/undici adds the
   * correct boundary automatically.
   */
  form?: FormData;
  /** If `true` (or the response is 204), the body is not parsed as JSON. */
  expectNoContent?: boolean;
}

/**
 * Internal HTTP client shared by {@link DielinesClient} and {@link DimensionsClient}.
 *
 * It is not exported as part of the package's public API (see `src/index.ts`); it exists only to
 * avoid duplicating authentication, serialization, timeout and error handling logic across both
 * clients.
 */
export class ApiHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiVersionHeader: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly minRequestIntervalMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Earliest time (ms since the epoch) at which the next request may start. */
  private nextRequestAt = 0;

  constructor(options: ApiHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.apiVersionHeader = options.apiVersionHeader;
    this.apiVersion = options.apiVersion ?? '1.0';
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.minRequestIntervalMs = options.minRequestIntervalMs ?? 1000;
    this.maxRetries = options.maxRetries ?? 2;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;

    if (!Number.isFinite(this.minRequestIntervalMs) || this.minRequestIntervalMs < 0) {
      throw new Error(
        `"minRequestIntervalMs" must be a non-negative finite number of milliseconds, received: ${String(options.minRequestIntervalMs)}`,
      );
    }
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) {
      throw new Error(
        `"maxRetries" must be a non-negative integer, received: ${String(options.maxRetries)}`,
      );
    }
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = this.buildUrl(options.path, options.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      [this.apiVersionHeader]: this.apiVersion,
    };

    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form !== undefined) {
      body = options.form;
    }

    for (let attempt = 0; ; attempt++) {
      await this.waitForSlot();
      const response = await this.send(url, options.method, headers, body);

      if (response.ok) {
        if (options.expectNoContent || response.status === 204) {
          return undefined as unknown as T;
        }
        return (await response.json()) as T;
      }

      const retryAfterMs =
        response.status === 429
          ? this.parseRetryAfter(this.readHeader(response, 'retry-after'))
          : undefined;

      if (
        response.status === 429 &&
        attempt < this.maxRetries &&
        (retryAfterMs === undefined || retryAfterMs <= MAX_RETRY_DELAY_MS)
      ) {
        // Releases the unread body of the discarded response before waiting.
        await response.body?.cancel().catch(() => undefined);
        await this.sleep(retryAfterMs ?? BASE_BACKOFF_MS * 2 ** attempt);
        continue;
      }

      const errorBody = await this.safeParseJson(response);
      const requestId = this.readHeader(response, 'x-request-id');
      throw mapErrorResponse(response.status, errorBody, requestId, retryAfterMs);
    }
  }

  /**
   * Reserves the next request slot synchronously, so concurrent callers queue one behind the
   * other instead of firing together, and waits until that slot starts.
   */
  private async waitForSlot(): Promise<void> {
    const now = this.now();
    const start = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = start + this.minRequestIntervalMs;
    if (start > now) {
      await this.sleep(start - now);
    }
  }

  /** Performs a single attempt with its own timeout; the timer is always cleared. */
  private async send(
    url: string,
    method: HttpMethod,
    headers: Record<string, string>,
    body: BodyInit | undefined,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `The diecuttemplates.com API request exceeded the timeout of ${this.timeoutMs}ms: ${method} ${url}`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /** Parses `Retry-After` (delay in seconds or HTTP-date) into milliseconds, if valid. */
  private parseRetryAfter(value: string | undefined): number | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return Math.round(Number(trimmed) * 1000);
    }
    if (!/[a-z]/i.test(trimmed)) {
      return undefined;
    }
    const date = Date.parse(trimmed);
    return Number.isNaN(date) ? undefined : Math.max(0, date - this.now());
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async safeParseJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return { message: response.statusText };
    }
  }

  private readHeader(response: Response, name: string): string | undefined {
    const headers = response.headers as unknown as
      { get?: (name: string) => string | null } | undefined;
    return headers?.get?.(name) ?? undefined;
  }
}
