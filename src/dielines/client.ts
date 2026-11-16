import { ApiHttpClient } from '../http-client';
import { PRODUCTION_BASE_URL, SANDBOX_BASE_URL } from '../constants';
import { mapDielineTemplateGroupList, mapDielineTemplate, mapCredits } from '../shared/mappers';
import type { Unit, DielineTemplateGroup, DielineTemplate, Credits } from '../shared/types';
import {
  mapDieline,
  mapDielineListPage,
  mapThreeDMockup,
  mapThreeDMockupListPage,
  mapNestingTemplateListResult,
  mapNestingTemplateEfficiencies,
  mapNesting,
  mapDielineTemplateListPage,
} from './mappers';
import type {
  Dieline,
  DielineListPage,
  ThreeDMockup,
  ThreeDMockupListPage,
  NestingTemplateListResult,
  NestingTemplateEfficiencies,
  Nesting,
  CreateDielineParams,
  Create3DMockupParams,
  Update3DMockupParams,
  NestingEfficienciesParams,
  CreateNestingParams,
  DielineTemplateSummary,
  DielineTemplateListPage,
  ListTemplatesParams,
  ListTemplatesExpandedParams,
  ListTemplatesSummaryParams,
} from './types';

/** Constructor configuration for {@link DielinesClient}. */
export interface DielinesClientConfig {
  /** Dielines API key (valid for both production and sandbox). */
  apiKey: string;
  /** Environment to use if no explicit `baseUrl` is passed. Defaults to `"production"`. */
  environment?: 'production' | 'sandbox';
  /** Explicit base URL; if provided, it takes precedence over `environment`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to `30000`. */
  timeoutMs?: number;
  /** `fetch` implementation to inject (useful for tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Client for the diecuttemplates.com Dielines API: generation of custom dielines, 3D mockups and
 * nesting layouts (sheet nesting).
 *
 * All requests are authenticated with `Authorization: Bearer <apiKey>` and
 * `Dielines-Api-Version: 1.0`. See the Pricing section of each method to know which operations
 * consume monthly quota.
 */
export class DielinesClient {
  private readonly http: ApiHttpClient;

  constructor(config: DielinesClientConfig) {
    const baseUrl =
      config.baseUrl ?? (config.environment === 'sandbox' ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL);
    this.http = new ApiHttpClient({
      baseUrl,
      apiKey: config.apiKey,
      apiVersionHeader: 'Dielines-Api-Version',
      timeoutMs: config.timeoutMs,
      fetchImpl: config.fetchImpl,
    });
  }

  /**
   * Gets the Dielines API credit balance (`GET /credits`): available credits, expiry and, if
   * borrowing is enabled, borrowed/borrowable credits. Never spends credits.
   */
  async getCredits(): Promise<Credits> {
    const response = await this.http.request<any>({ method: 'GET', path: '/credits' });
    return mapCredits(response);
  }

  /**
   * Lists all available dieline template groups (e.g. "Tuck End Boxes" within "Cartons").
   * Does not consume quota.
   */
  async listTemplateGroups(): Promise<DielineTemplateGroup[]> {
    const response = await this.http.request<any>({
      method: 'GET',
      path: '/dieline-template-groups',
    });
    return mapDielineTemplateGroupList(response);
  }

  /**
   * Gets the details of a dieline template: customizable variables, navigation links to related
   * variants (`change_flap`, `add_top_postal_lock`, etc.) and images. Does not consume quota.
   *
   * @param id Template id, e.g. `"becf-10301"`.
   * @param unit Unit in which the default variable values are returned.
   */
  async getTemplate(id: string, unit: Unit): Promise<DielineTemplate> {
    const response = await this.http.request<any>({
      method: 'GET',
      path: `/dieline-templates/${encodeURIComponent(unit)}/${encodeURIComponent(id)}`,
    });
    return mapDielineTemplate(response?.dieline_template);
  }

  /**
   * Lists dieline templates, paginated (`GET /dieline-templates`). Does not consume quota.
   *
   * Without `expand` it returns summaries ({@link DielineTemplateSummary}); with `expand: true` it
   * returns full templates and `unit` is required.
   *
   * @throws Error if `pageSize` is not between 1 and 100, if `page` is less than 1, or if `expand`
   * is `true` and `unit` is missing.
   */
  async listTemplates(
    params: ListTemplatesExpandedParams,
  ): Promise<DielineTemplateListPage<DielineTemplate>>;
  async listTemplates(
    params?: ListTemplatesSummaryParams,
  ): Promise<DielineTemplateListPage<DielineTemplateSummary>>;
  async listTemplates(
    params: ListTemplatesParams = {},
  ): Promise<DielineTemplateListPage<DielineTemplateSummary | DielineTemplate>> {
    const { groupId, page, pageSize, expand, unit } = params;
    if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) {
      throw new Error(
        `listTemplates: "pageSize" must be an integer between 1 and 100 (received ${pageSize}).`,
      );
    }
    if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
      throw new Error(
        `listTemplates: "page" must be an integer greater than or equal to 1 (received ${page}).`,
      );
    }
    if (expand && !unit) {
      throw new Error('listTemplates: "unit" is required when "expand" is true.');
    }
    const response = await this.http.request<any>({
      method: 'GET',
      path: '/dieline-templates',
      query: { group_id: groupId, page, page_size: pageSize, expand, unit },
    });
    return mapDielineTemplateListPage(response, Boolean(expand));
  }

  /**
   * Walks through all pages of templates using the same filters as {@link listTemplates} and
   * yields the items one at a time. If `pageSize` is not given, it uses 100 (the maximum) to
   * minimize requests. Ignores `page` and always starts at page 1.
   */
  iterateTemplates(
    params: ListTemplatesExpandedParams,
  ): AsyncGenerator<DielineTemplate, void, undefined>;
  iterateTemplates(
    params?: ListTemplatesSummaryParams,
  ): AsyncGenerator<DielineTemplateSummary, void, undefined>;
  async *iterateTemplates(
    params: ListTemplatesParams = {},
  ): AsyncGenerator<DielineTemplateSummary | DielineTemplate, void, undefined> {
    let page = 1;
    for (;;) {
      const result = await this.listTemplates({
        ...params,
        page,
        pageSize: params.pageSize ?? 100,
      } as ListTemplatesSummaryParams);
      for (const item of result.dielineTemplates) {
        yield item;
      }
      if (!result.hasNextPage || result.dielineTemplates.length === 0) return;
      page += 1;
    }
  }

  /** Collects all items from {@link iterateTemplates} into an array. */
  async listAllTemplates(params: ListTemplatesExpandedParams): Promise<DielineTemplate[]>;
  async listAllTemplates(params?: ListTemplatesSummaryParams): Promise<DielineTemplateSummary[]>;
  async listAllTemplates(
    params: ListTemplatesParams = {},
  ): Promise<Array<DielineTemplateSummary | DielineTemplate>> {
    const all: Array<DielineTemplateSummary | DielineTemplate> = [];
    for await (const item of this.iterateTemplates(params as ListTemplatesSummaryParams)) {
      all.push(item);
    }
    return all;
  }

  /**
   * Generates a custom dieline (PDF, DXF or SVG) from a template and its variables.
   *
   * Consumes 1 credit of the monthly plan per unique combination of dimensions (only the first time;
   * requesting another `format` for the same dimensions is free). The demo template
   * `becf-11101` and any request in the sandbox environment never consume quota.
   */
  async createDieline(templateId: string, params: CreateDielineParams): Promise<Dieline> {
    const response = await this.http.request<any>({
      method: 'POST',
      path: `/dieline-templates/${encodeURIComponent(templateId)}/dielines`,
      json: {
        format: params.format,
        pdf_header: params.pdfHeader,
        area: params.area,
        // Per the docs, `dimension_texts` is a member of `variables`, not a top-level field.
        variables:
          params.dimensionTexts === undefined
            ? params.variables
            : { ...params.variables, dimension_texts: params.dimensionTexts },
      },
    });
    return mapDieline(this, response?.dieline);
  }

  /**
   * Lists the dielines already generated from a template, paginated (API default page size: 100).
   * Does not consume quota.
   */
  async listDielines(
    templateId: string,
    params?: { page?: number; pageSize?: number },
  ): Promise<DielineListPage> {
    const response = await this.http.request<any>({
      method: 'GET',
      path: `/dieline-templates/${encodeURIComponent(templateId)}/dielines`,
      query: { page: params?.page, page_size: params?.pageSize },
    });
    return mapDielineListPage(this, response);
  }

  /**
   * Uploads an artwork file (PNG, JPEG, JPG, SVG or PDF) and generates a 3D mockup for the given
   * dieline. Does not consume quota.
   */
  async create3DMockup(dielineId: string, params: Create3DMockupParams): Promise<ThreeDMockup> {
    const response = await this.http.request<any>({
      method: 'POST',
      path: `/dielines/${encodeURIComponent(dielineId)}/3d-mockups`,
      form: this.buildMockupForm(params),
    });
    return mapThreeDMockup(this, response?.['3d_mockup']);
  }

  /**
   * Updates an existing 3D mockup. All fields are optional (only the ones present are sent).
   * Does not consume quota.
   */
  async update3DMockup(
    dielineId: string,
    mockupId: string,
    params: Update3DMockupParams,
  ): Promise<ThreeDMockup> {
    const response = await this.http.request<any>({
      method: 'PUT',
      path: `/dielines/${encodeURIComponent(dielineId)}/3d-mockups/${encodeURIComponent(mockupId)}`,
      form: this.buildMockupForm(params),
    });
    return mapThreeDMockup(this, response?.['3d_mockup']);
  }

  /**
   * Lists the 3D mockups generated for a dieline, paginated. Does not consume quota.
   */
  async list3DMockups(
    dielineId: string,
    params?: { page?: number; pageSize?: number },
  ): Promise<ThreeDMockupListPage> {
    const response = await this.http.request<any>({
      method: 'GET',
      path: `/dielines/${encodeURIComponent(dielineId)}/3d-mockups`,
      query: { page: params?.page, page_size: params?.pageSize },
    });
    return mapThreeDMockupListPage(this, response);
  }

  /**
   * Deletes a 3D mockup. The API responds with `204 No Content` and no body. Does not consume quota.
   */
  async delete3DMockup(dielineId: string, mockupId: string): Promise<void> {
    await this.http.request<void>({
      method: 'DELETE',
      path: `/dielines/${encodeURIComponent(dielineId)}/3d-mockups/${encodeURIComponent(mockupId)}`,
      expectNoContent: true,
    });
  }

  /**
   * Lists the nesting templates (sheet layouts) compatible with a dieline, automatically filtered
   * by dimensions and material. Does not consume quota.
   */
  async listNestingTemplates(dielineId: string): Promise<NestingTemplateListResult> {
    const response = await this.http.request<any>({
      method: 'GET',
      path: `/dielines/${encodeURIComponent(dielineId)}/nesting-templates`,
    });
    return mapNestingTemplateListResult(this, response);
  }

  /**
   * Calculates the nesting efficiency of each compatible template for a sheet of the given
   * dimensions, without generating any file. Does not consume quota.
   */
  async calculateNestingEfficiencies(
    dielineId: string,
    params: NestingEfficienciesParams,
  ): Promise<NestingTemplateEfficiencies> {
    const response = await this.http.request<any>({
      method: 'POST',
      path: `/dielines/${encodeURIComponent(dielineId)}/nesting-template-efficiencies`,
      json: {
        variables: {
          unit: params.variables.unit,
          sheet_width: params.variables.sheetWidth,
          sheet_height: params.variables.sheetHeight,
          sheet_margin_top: params.variables.sheetMarginTop,
          sheet_margin_bottom: params.variables.sheetMarginBottom,
          sheet_margin_side: params.variables.sheetMarginSide,
        },
      },
    });
    return mapNestingTemplateEfficiencies(this, response);
  }

  /**
   * Generates the nesting file (a sheet with multiple copies of the dieline arranged according to
   * the chosen nesting template). Per the API's Pricing section, only the creation of dielines with
   * custom dimensions consumes quota: this endpoint is not listed as consuming credits.
   */
  async createNesting(
    dielineId: string,
    nestingTemplateId: string,
    params: CreateNestingParams,
  ): Promise<Nesting> {
    const {
      unit,
      sheetWidth,
      sheetHeight,
      sheetMarginTop,
      sheetMarginBottom,
      sheetMarginSide,
      numX,
      numY,
      ...rest
    } = params.variables;
    const response = await this.http.request<any>({
      method: 'POST',
      path: `/dielines/${encodeURIComponent(dielineId)}/nestings/${encodeURIComponent(nestingTemplateId)}`,
      json: {
        format: params.format,
        pdf_header: params.pdfHeader,
        variables: {
          unit,
          sheet_width: sheetWidth,
          sheet_height: sheetHeight,
          sheet_margin_top: sheetMarginTop,
          sheet_margin_bottom: sheetMarginBottom,
          sheet_margin_side: sheetMarginSide,
          num_x: numX,
          num_y: numY,
          // Per the docs, `dimension_texts` is a member of `variables`, not a top-level field.
          dimension_texts: params.dimensionTexts,
          ...rest,
        },
      },
    });
    return mapNesting(response);
  }

  private buildMockupForm(params: Create3DMockupParams | Update3DMockupParams): FormData {
    const form = new FormData();
    if (params.file !== undefined) {
      const blob =
        params.file instanceof Blob
          ? params.file
          : new Blob([new Uint8Array(params.file)], {
              type: params.contentType ?? 'application/octet-stream',
            });
      form.append('file', blob, params.fileName ?? 'artwork');
    }
    if (params.name !== undefined) form.append('name', params.name);
    if (params.outsideDesign !== undefined)
      form.append('outside_design', String(params.outsideDesign));
    if (params.sceneBackgroundColor !== undefined) {
      form.append('scene_background_color', params.sceneBackgroundColor);
    }
    if (params.substrate !== undefined) form.append('substrate', params.substrate);
    if (params.partSubstrates !== undefined) {
      // The API expects one bracketed field per part: `part_substrates[1]=corrugated_brown`.
      for (const [part, key] of Object.entries(params.partSubstrates)) {
        form.append(`part_substrates[${part}]`, key);
      }
    }
    return form;
  }
}
