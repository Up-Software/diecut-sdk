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
}

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

  constructor(options: ApiHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.apiVersionHeader = options.apiVersionHeader;
    this.apiVersion = options.apiVersion ?? '1.0';
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
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

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `The diecuttemplates.com API request exceeded the timeout of ${this.timeoutMs}ms: ${options.method} ${url}`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      const errorBody = await this.safeParseJson(response);
      const requestId = this.readHeader(response, 'x-request-id');
      throw mapErrorResponse(response.status, errorBody, requestId);
    }

    if (options.expectNoContent || response.status === 204) {
      return undefined as unknown as T;
    }

    return (await response.json()) as T;
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
