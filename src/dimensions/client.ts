import { ApiHttpClient } from '../http-client';
import { PRODUCTION_BASE_URL, SANDBOX_BASE_URL } from '../constants';
import { mapDielineTemplateGroupList, mapDielineTemplate, mapCredits } from '../shared/mappers';
import type { Unit, DielineTemplateGroup, DielineTemplate, Credits } from '../shared/types';
import { mapPartListResult } from './mappers';
import type { CalculatePartsParams, PartListResult } from './types';

/** Constructor configuration for {@link DimensionsClient}. */
export interface DimensionsClientConfig {
  /** Dieline Dimensions API key (`dim_` prefix, valid for production and sandbox). */
  apiKey: string;
  /** Environment to use if no explicit `baseUrl` is passed. Defaults to `"production"`. */
  environment?: 'production' | 'sandbox';
  /** Explicit base URL; if provided, it takes precedence over `environment`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to `30000`. */
  timeoutMs?: number;
  /** `fetch` implementation to inject (useful for tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * Minimum time in milliseconds between the start of two requests from this client instance
   * (the API allows 1 request per second). Defaults to `1000`; `0` disables the limiter.
   */
  minRequestIntervalMs?: number;
  /** Maximum retries on `429 Too Many Requests`. Defaults to `2`; `0` disables retries. */
  maxRetries?: number;
}

/**
 * Client for the diecuttemplates.com Dieline Dimensions API: it returns only the flat dimensions
 * (width/height and, optionally, area) of a dieline's parts, without generating or exporting any
 * file. Intended for quoting flows/configurators that only need sizes.
 *
 * It uses the same base URLs as the Dielines API (`https://api.diecuttemplates.com` /
 * `https://sandbox.api.diecuttemplates.com`), but with the `Dimensions-Api-Version: 1.0` header and
 * routes under `/dimensions/...` (not `/docs/dimensions-api/...`, which is only the public
 * documentation URL).
 */
export class DimensionsClient {
  private readonly http: ApiHttpClient;

  constructor(config: DimensionsClientConfig) {
    const baseUrl =
      config.baseUrl ?? (config.environment === 'sandbox' ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL);
    this.http = new ApiHttpClient({
      baseUrl,
      apiKey: config.apiKey,
      apiVersionHeader: 'Dimensions-Api-Version',
      timeoutMs: config.timeoutMs,
      fetchImpl: config.fetchImpl,
      minRequestIntervalMs: config.minRequestIntervalMs,
      maxRetries: config.maxRetries,
    });
  }

  /**
   * Gets the Dieline Dimensions API credit balance (`GET /dimensions/credits`). It reports only
   * Dimensions credits and never spends any.
   */
  async getCredits(): Promise<Credits> {
    const response = await this.http.request<any>({ method: 'GET', path: '/dimensions/credits' });
    return mapCredits(response);
  }

  /**
   * Lists the template groups available for calculating dimensions. Does not consume credits.
   */
  async listTemplateGroups(): Promise<DielineTemplateGroup[]> {
    const response = await this.http.request<any>({
      method: 'GET',
      path: '/dimensions/template-groups',
    });
    return mapDielineTemplateGroupList(response);
  }

  /**
   * Gets the details of a template (customizable variables, links, images). Does not consume
   * credits.
   *
   * @param id Template id, e.g. `"becf-11a02"`.
   * @param unit Unit of the returned values. Defaults to `"mm"` if omitted (per the documentation).
   */
  async getTemplate(id: string, unit: Unit = 'mm'): Promise<DielineTemplate> {
    const response = await this.http.request<any>({
      method: 'GET',
      path: `/dimensions/${encodeURIComponent(id)}`,
      query: { unit },
    });
    return mapDielineTemplate(response?.dieline_template);
  }

  /**
   * Calculates the dimensions (width/height per part and, optionally, area) of a template for
   * the given variables, without generating any file.
   *
   * Consumes 1 Dieline Dimensions API credit per request (per the pricing: USD 49.90 per 1000
   * credits, valid for 3 months). The demo template `becf-11101` is free in any environment, and
   * the documentation states that identical requests repeated within 7 days are not charged again.
   */
  async calculateParts(templateId: string, params: CalculatePartsParams): Promise<PartListResult> {
    const response = await this.http.request<any>({
      method: 'POST',
      path: `/dimensions/${encodeURIComponent(templateId)}/parts`,
      json: {
        variables: params.variables,
        area: params.area,
      },
    });
    return mapPartListResult(response);
  }
}
