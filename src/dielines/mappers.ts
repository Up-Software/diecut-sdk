import {
  mapLinks,
  hasNextPage,
  mapUnit,
  toNumber,
  toOptionalNumber,
  mapDielineTemplateVariable,
  mapDielineTemplate,
} from '../shared/mappers';
import type {
  DielineArea,
  Dieline,
  DielineActions,
  DielineListPage,
  DielineVariables,
  ThreeDMockup,
  ThreeDMockupActions,
  ThreeDMockupListPage,
  NestingTemplate,
  NestingTemplateActions,
  NestingTemplateComponent,
  NestingTemplateListResult,
  NestingTemplateEfficiencies,
  NestingEfficiency,
  NestingVariables,
  Nesting,
  Create3DMockupParams,
  Update3DMockupParams,
  NestingEfficienciesParams,
  CreateNestingParams,
  DielineTemplateSummary,
  DielineTemplateListPage,
} from './types';
import type { DielineTemplate, DielineTemplateImage } from '../shared/types';
import type { DielinesClient } from './client';

/**
 * Internal "mapper" functions of the Dielines API: they convert raw JSON (`any`, already unwrapped from the
 * response wrapper) into the SDK's TS types, normalizing inconsistent numeric fields
 * (`material`, `artwork_dimensions.width/height`, etc.) and the field name
 * `"3d_mockups"`, which starts with a digit.
 *
 * Besides mapping data, they attach to each resource (`Dieline`, `ThreeDMockup`, `NestingTemplate`)
 * the convenience actions based on its HATEOAS `links` (see `*Actions` in `./types`), bound
 * by closure to the `client` that made the call, and return the frozen object (`Object.freeze`)
 * so the interface is immutable.
 */

/**
 * Normalizes the `variables` object of a dieline (or the `dieline_variables` nested inside a
 * nesting): separates `unit`/`material` with explicit numeric normalization and leaves the other
 * template-specific variables exactly as they came.
 */
export function mapDielineVariables(raw: any): DielineVariables {
  const source = raw ?? {};
  const variables: DielineVariables = { unit: mapUnit(source.unit) };
  for (const [key, value] of Object.entries(source)) {
    if (key === 'unit') continue;
    if (key === 'material') {
      variables.material = toOptionalNumber(value);
      continue;
    }
    variables[key] = value as number | string | boolean;
  }
  return variables;
}

type DielineData = Omit<Dieline, keyof DielineActions>;

function mapPartAreas(raw: any): Record<string, DielineArea> | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(raw).map(([part, area]: [string, any]) => [
      part,
      { unit: area?.unit, value: toNumber(area?.value) },
    ]),
  );
}

function mapDielineData(raw: any): DielineData {
  const data = raw ?? {};
  return {
    type: 'dieline',
    id: data.id,
    dielineTemplateId: data.dieline_template_id,
    variables: mapDielineVariables(data.variables),
    format: data.format,
    url: data.url,
    artworkDimensions: data.artwork_dimensions
      ? {
          unit: data.artwork_dimensions.unit,
          width: toNumber(data.artwork_dimensions.width),
          height: toNumber(data.artwork_dimensions.height),
        }
      : undefined,
    area: data.area ? { unit: data.area.unit, value: toNumber(data.area.value) } : undefined,
    partAreas: mapPartAreas(data.part_areas),
    substrateParts: Array.isArray(data.substrate_parts)
      ? data.substrate_parts.map((p: any) => ({
          part: p?.part ?? null,
          name: p?.name,
          param: p?.param,
        }))
      : [],
    links: mapLinks(data.links),
    createdAt: data.created_at,
  };
}

/**
 * Maps a raw `dieline` object (already unwrapped from `{ dieline: {...} }`) and attaches the
 * {@link DielineActions} bound to `client`. Returns a frozen object.
 */
export function mapDieline(client: DielinesClient, raw: any): Dieline {
  const data = mapDielineData(raw);
  const actions: DielineActions = {
    create3DMockup: (params: Create3DMockupParams) => client.create3DMockup(data.id, params),
    listNestingTemplates: () => client.listNestingTemplates(data.id),
    calculateNestingEfficiencies: (params: NestingEfficienciesParams) =>
      client.calculateNestingEfficiencies(data.id, params),
  };
  return Object.freeze({ ...data, ...actions });
}

type ThreeDMockupData = Omit<ThreeDMockup, keyof ThreeDMockupActions>;

function mapThreeDMockupData(client: DielinesClient, raw: any): ThreeDMockupData {
  const data = raw ?? {};
  return {
    type: '3d_mockup',
    id: data.id,
    url: data.url,
    name: data.name,
    dieline: mapDieline(client, data.dieline),
    links: mapLinks(data.links),
    createdAt: data.created_at,
  };
}

/**
 * Maps a raw `3d_mockup` object (already unwrapped from `{ "3d_mockup": {...} }`) and attaches the
 * {@link ThreeDMockupActions} bound to `client`. Returns a frozen object.
 */
export function mapThreeDMockup(client: DielinesClient, raw: any): ThreeDMockup {
  const data = mapThreeDMockupData(client, raw);
  const actions: ThreeDMockupActions = {
    update: (params: Update3DMockupParams) =>
      client.update3DMockup(data.dieline.id, data.id, params),
    delete: () => client.delete3DMockup(data.dieline.id, data.id),
  };
  return Object.freeze({ ...data, ...actions });
}

/**
 * Maps the full response of `GET /dielines/{dieline_id}/3d-mockups`. Receives the body
 * unwrapped because it needs to read the literal key `"3d_mockups"` (it starts with a digit).
 */
export function mapThreeDMockupListPage(client: DielinesClient, raw: any): ThreeDMockupListPage {
  const list = raw?.['3d_mockup_list'] ?? {};
  const mockups = list['3d_mockups'];
  const total = toNumber(list.total);
  const page = toNumber(list.page);
  const pageSize = toNumber(list.page_size);
  // The docs place `links` inside the list object; some examples show it beside it.
  const links = mapLinks(list.links ?? raw?.links);
  return {
    total,
    page,
    pageSize,
    dielineId: list.dieline_id,
    threeDMockups: Array.isArray(mockups)
      ? mockups.map((m: any) => mapThreeDMockup(client, m))
      : [],
    links,
    hasNextPage: hasNextPage(links, page, pageSize, total),
  };
}

/** Maps the full response of `GET /dieline-templates/{id}/dielines` (`{ dieline_list: {...} }`). */
export function mapDielineListPage(client: DielinesClient, raw: any): DielineListPage {
  const list = raw?.dieline_list ?? {};
  const total = toNumber(list.total);
  const page = toNumber(list.page);
  const pageSize = toNumber(list.page_size);
  // The docs place `links` inside the list object; some examples show it beside it.
  const links = mapLinks(list.links ?? raw?.links);
  return {
    dielineTemplateId: list.dieline_template_id,
    total,
    page,
    pageSize,
    dielines: Array.isArray(list.dielines)
      ? list.dielines.map((d: any) => mapDieline(client, d))
      : [],
    links,
    hasNextPage: hasNextPage(links, page, pageSize, total),
  };
}

function mapNestingTemplateComponent(raw: any): NestingTemplateComponent {
  return {
    type: 'nesting_template_component',
    id: raw?.id,
    name: raw?.name,
    category: raw?.category,
  };
}

/**
 * Maps a raw `nesting_template_components` value. The real API sometimes returns an array that
 * contains an empty array (`[[]]`), so one level of nesting is flattened and entries that are not
 * objects with an `id` are dropped, to never produce components with undefined fields.
 */
function mapNestingTemplateComponents(raw: any): NestingTemplateComponent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flat(1)
    .filter(
      (entry: any) =>
        entry !== null &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        entry.id !== undefined &&
        entry.id !== null,
    )
    .map(mapNestingTemplateComponent);
}

function mapTemplateImage(raw: any): DielineTemplateImage {
  return { type: raw?.type, url: raw?.url ?? null };
}

type NestingTemplateData = Omit<NestingTemplate, keyof NestingTemplateActions>;

function mapNestingTemplateData(raw: any): NestingTemplateData {
  const data = raw ?? {};
  return {
    type: 'nesting_template',
    id: data.id,
    dielineTemplateId: data.dieline_template_id,
    nestingTemplateComponents: mapNestingTemplateComponents(data.nesting_template_components),
    variables: Array.isArray(data.variables) ? data.variables.map(mapDielineTemplateVariable) : [],
    // The object page documents a singular `image`; the examples use an `images` array.
    images: Array.isArray(data.images)
      ? data.images.map(mapTemplateImage)
      : data.image
        ? [mapTemplateImage(data.image)]
        : [],
    links: mapLinks(data.links),
  };
}

/**
 * Maps a raw `nesting_template` and attaches {@link NestingTemplateActions.createNesting},
 * bound to the `client` and to the `dielineId` of the listing it came from (it does not travel in the
 * JSON of the nesting template itself). Returns a frozen object.
 */
export function mapNestingTemplate(
  client: DielinesClient,
  dielineId: string,
  raw: any,
): NestingTemplate {
  const data = mapNestingTemplateData(raw);
  const actions: NestingTemplateActions = {
    createNesting: (params: CreateNestingParams) =>
      client.createNesting(dielineId, data.id, params),
  };
  return Object.freeze({ ...data, ...actions });
}

/** Maps the full response of `GET /dielines/{dieline_id}/nesting-templates`. */
export function mapNestingTemplateListResult(
  client: DielinesClient,
  raw: any,
): NestingTemplateListResult {
  // The resource page names the wrapper `nesting_templates_list`; the object page `nesting_template_list`.
  const list = raw?.nesting_template_list ?? raw?.nesting_templates_list ?? {};
  const dielineId = list.dieline_id;
  return {
    id: list.id,
    dielineId,
    dielineTemplateId: list.dieline_template_id,
    total: toNumber(list.total),
    nestingTemplateComponents: mapNestingTemplateComponents(list.nesting_template_components),
    nestingTemplates: Array.isArray(list.nesting_templates)
      ? list.nesting_templates.map((t: any) => mapNestingTemplate(client, dielineId, t))
      : [],
  };
}

function mapNestingEfficiency(raw: any): NestingEfficiency | null {
  if (raw === null || raw === undefined) return null;
  return {
    numX: toNumber(raw.num_x),
    numY: toNumber(raw.num_y),
    efficiency: {
      value: toNumber(raw.efficiency?.value),
      type: raw.efficiency?.type,
    },
  };
}

/** Maps the full response of `POST /dielines/{dieline_id}/nesting-template-efficiencies`. */
export function mapNestingTemplateEfficiencies(
  client: DielinesClient,
  raw: any,
): NestingTemplateEfficiencies {
  const data = raw?.nesting_template_efficiencies ?? {};
  const dielineId = data.dieline_id;
  const efficiencies: Record<string, NestingEfficiency | null> = {};
  for (const [key, value] of Object.entries(data.efficiencies ?? {})) {
    efficiencies[key] = mapNestingEfficiency(value);
  }
  return {
    dielineId,
    dielineTemplateId: data.dieline_template_id,
    variables: data.variables ?? {},
    efficiencies,
    nestingTemplates: Array.isArray(data.nesting_templates)
      ? data.nesting_templates.map((t: any) => mapNestingTemplate(client, dielineId, t))
      : [],
    nestingTemplateComponents: mapNestingTemplateComponents(data.nesting_template_components),
  };
}

const KNOWN_NESTING_VARIABLE_KEYS = new Set([
  'unit',
  'sheet_width',
  'sheet_height',
  'sheet_margin_top',
  'sheet_margin_bottom',
  'sheet_margin_side',
  'dimension_texts',
  'num_x',
  'num_y',
  'margin_x',
  'margin_y',
  'dieline_variables',
]);

function mapNestingVariables(raw: any): NestingVariables {
  const data = raw ?? {};
  // Template-specific variables (e.g. `blok_x`) keep their original snake_case names.
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_NESTING_VARIABLE_KEYS.has(key)) extra[key] = value;
  }
  return {
    ...extra,
    unit: mapUnit(data.unit),
    sheetWidth: toNumber(data.sheet_width),
    sheetHeight: toNumber(data.sheet_height),
    sheetMarginTop: toOptionalNumber(data.sheet_margin_top),
    sheetMarginBottom: toOptionalNumber(data.sheet_margin_bottom),
    sheetMarginSide: toOptionalNumber(data.sheet_margin_side),
    dimensionTexts: data.dimension_texts,
    numX: toOptionalNumber(data.num_x),
    numY: toOptionalNumber(data.num_y),
    marginX: toOptionalNumber(data.margin_x),
    marginY: toOptionalNumber(data.margin_y),
    dielineVariables: data.dieline_variables
      ? mapDielineVariables(data.dieline_variables)
      : undefined,
  };
}

/** Maps the full response of `POST /dielines/{dieline_id}/nestings/{nesting_template_id}`. */
export function mapNesting(raw: any): Nesting {
  const data = raw?.nesting ?? {};
  return {
    type: 'nesting',
    id: data.id,
    dielineId: data.dieline_id,
    dielineTemplateId: data.dieline_template_id,
    nestingTemplateId: data.nesting_template_id,
    variables: mapNestingVariables(data.variables),
    format: data.format,
    width: { value: toNumber(data.width?.value), unit: data.width?.unit },
    height: { value: toNumber(data.height?.value), unit: data.height?.unit },
    nestingOverflow: Boolean(data.nesting_overflow),
    sumOfLineLengths: Array.isArray(data.sum_of_line_lengths)
      ? data.sum_of_line_lengths.map((entry: any) => ({
          name: entry?.name,
          unit: entry?.unit,
          value: toNumber(entry?.value),
        }))
      : [],
    url: data.url,
    createdAt: data.created_at,
  };
}

/** Maps a raw `dieline_template_summary` from the template listing. */
export function mapDielineTemplateSummary(raw: any): DielineTemplateSummary {
  const codes = Array.isArray(raw?.standard_codes)
    ? raw.standard_codes.map((c: any) => ({
        type: c?.type,
        value: c?.value,
        approximate: Boolean(c?.approximate),
      }))
    : undefined;
  return {
    type: 'dieline_template_summary',
    id: raw?.id,
    groupId: raw?.group_id,
    standardCodes: codes,
    images: Array.isArray(raw?.images) ? raw.images.map(mapTemplateImage) : [],
    links: mapLinks(raw?.links),
  };
}

/**
 * Maps the response of `GET /dieline-templates`. With `expand` the items are full templates;
 * otherwise, summaries.
 */
export function mapDielineTemplateListPage(
  response: any,
  expand: boolean,
): DielineTemplateListPage<DielineTemplateSummary | DielineTemplate> {
  const list = response?.dieline_template_list ?? response ?? {};
  const total = toNumber(list.total);
  const page = toNumber(list.page);
  const pageSize = toNumber(list.page_size);
  const links = mapLinks(list.links);
  const rawItems: any[] = Array.isArray(list.dieline_templates) ? list.dieline_templates : [];
  return {
    total,
    page,
    pageSize,
    dielineTemplates: rawItems.map((item) =>
      expand ? mapDielineTemplate(item) : mapDielineTemplateSummary(item),
    ),
    links,
    hasNextPage: hasNextPage(links, page, pageSize, total),
  };
}
