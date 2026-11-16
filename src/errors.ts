/**
 * Error hierarchy for the diecuttemplates.com SDK.
 *
 * Both APIs (Dielines and Dieline Dimensions) document consistent error shapes:
 * - Simple errors: `{ message: string }` (typical of 401/403/404 and some GET 400s).
 * - Validation errors: `{ message: string, errors: [{ message: string, suggestion?: {...} }] }`
 *   (typical of POST requests that validate template variables).
 */

/** Suggested fix included in a validation issue (400). */
export interface DiecutValidationSuggestion {
  /** Suggestion type: change a value or swap two values. */
  type?: 'change_value' | 'swap_values' | string;
  /** Name of the variable to fix (for `change_value`). */
  name?: string;
  /** Suggested value (for `change_value`). */
  value?: number;
  /** Names of the variables to swap (for `swap_values`). */
  names?: string[];
  /**
   * Some documented Dielines API examples nest one `suggestion` inside another
   * (`{ suggestion: { suggestion: {...} } }`). This is almost certainly a documentation bug,
   * but it is transcribed as is so no information is lost if the real API does the same.
   */
  suggestion?: DiecutValidationSuggestion;
}

/** A single issue inside the `errors` array of a 400 validation response. */
export interface DiecutValidationIssue {
  message: string;
  suggestion?: DiecutValidationSuggestion;
}

/**
 * Base error for any unsuccessful response (status outside the 2xx range) from the
 * diecuttemplates.com APIs.
 */
export class DiecutApiError extends Error {
  /** HTTP status code of the response. */
  readonly status: number;
  /** Raw body (already parsed as JSON, or `{ message: statusText }` if it could not be parsed). */
  readonly body: unknown;
  /** Request identifier, if the API exposed it in some header (not explicitly documented). */
  readonly requestId?: string;

  constructor(status: number, body: unknown, message?: string, requestId?: string) {
    super(message ?? DiecutApiError.extractMessage(body));
    this.name = 'DiecutApiError';
    this.status = status;
    this.body = body;
    this.requestId = requestId;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  protected static extractMessage(body: unknown): string {
    if (body && typeof body === 'object' && 'message' in (body as Record<string, unknown>)) {
      const message = (body as Record<string, unknown>).message;
      if (typeof message === 'string' && message.length > 0) {
        return message;
      }
    }
    return 'The diecuttemplates.com API returned an error without a message.';
  }
}

/**
 * Validation error (400) shaped like `{ message, errors: [{ message, suggestion? }] }`,
 * typical of POST endpoints that validate template variables (create dieline, nesting, etc.).
 */
export class DiecutValidationError extends DiecutApiError {
  /** List of individual validation issues returned by the API. */
  readonly errors: DiecutValidationIssue[];

  constructor(status: number, body: unknown, requestId?: string) {
    super(status, body, undefined, requestId);
    this.name = 'DiecutValidationError';
    const rawErrors =
      body && typeof body === 'object' ? (body as Record<string, unknown>).errors : undefined;
    this.errors = Array.isArray(rawErrors) ? (rawErrors as DiecutValidationIssue[]) : [];
  }
}

/** Authentication/authorization error (401 Unauthorized or 403 Forbidden). */
export class DiecutAuthError extends DiecutApiError {
  constructor(status: number, body: unknown, requestId?: string) {
    super(status, body, undefined, requestId);
    this.name = 'DiecutAuthError';
  }
}

/** Resource not found error (404 Not Found). */
export class DiecutNotFoundError extends DiecutApiError {
  constructor(status: number, body: unknown, requestId?: string) {
    super(status, body, undefined, requestId);
    this.name = 'DiecutNotFoundError';
  }
}

/**
 * Decides which {@link DiecutApiError} subclass to instantiate based on the HTTP status and the
 * shape of the response body.
 */
export function mapErrorResponse(
  status: number,
  body: unknown,
  requestId?: string,
): DiecutApiError {
  if (status === 400) {
    return new DiecutValidationError(status, body, requestId);
  }
  if (status === 401 || status === 403) {
    return new DiecutAuthError(status, body, requestId);
  }
  if (status === 404) {
    return new DiecutNotFoundError(status, body, requestId);
  }
  return new DiecutApiError(status, body, undefined, requestId);
}
