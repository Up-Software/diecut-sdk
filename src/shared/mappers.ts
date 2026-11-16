import type {
  Unit,
  Link,
  DielineTemplateGroup,
  Credits,
  DielineTemplateFeatureSlot,
  DielineTemplateVariable,
  DielineTemplateVariableDefaultValue,
  DielineTemplateImage,
  DielineTemplate,
} from './types';

/**
 * Internal "mapper" functions that convert raw JSON (`any`) from the diecuttemplates.com APIs
 * into the SDK's TS types, explicitly normalizing the inconsistencies documented in the
 * "Cross-Cutting Notes for SDK Implementation" section of the Dielines API spec (numeric fields
 * sometimes sent as strings, `unit`/`material` sometimes nested, etc.).
 *
 * They are not exported from `src/index.ts`: they are an implementation detail shared between
 * `src/dielines/*` and `src/dimensions/*`.
 */

/** Leniently converts a `number | string` value to `number`. Returns `NaN` if it cannot. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return parsed;
  }
  return NaN;
}

/** Same as {@link toNumber}, but returns `undefined` for `null`/`undefined`/non-numeric values. */
export function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = toNumber(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Normalizes the `unit` field, falling back to `"mm"` if an unexpected value arrives. */
export function mapUnit(value: unknown): Unit {
  return value === 'in' ? 'in' : 'mm';
}

export function mapLink(raw: any): Link {
  return {
    rel: raw?.rel,
    href: raw?.href,
    method: raw?.method,
    name: raw?.name,
  };
}

export function mapLinks(raw: unknown): Link[] {
  return Array.isArray(raw) ? raw.map(mapLink) : [];
}

/**
 * Whether a paginated list has another page: the `next_page` link if the API sent links, or
 * `page * pageSize < total` otherwise.
 */
export function hasNextPage(links: Link[], page: number, pageSize: number, total: number): boolean {
  return links.length > 0 ? links.some((l) => l.rel === 'next_page') : page * pageSize < total;
}

export function mapDielineTemplateGroup(raw: any): DielineTemplateGroup {
  const codes = Array.isArray(raw?.standard_codes)
    ? raw.standard_codes.map((c: any) => ({
        type: c?.type,
        value: c?.value,
        approximate: Boolean(c?.approximate),
      }))
    : undefined;
  return {
    type: 'dieline_template_group',
    id: raw?.id,
    name: raw?.name,
    category: raw?.category,
    standardCodes: codes,
  };
}

/** Maps the response of the credits endpoints (`{ credits: {...} }`). */
export function mapCredits(raw: any): Credits {
  const data = raw?.credits ?? raw ?? {};
  return {
    type: 'credits',
    product: data.product,
    available: toNumber(data.available),
    expiresAt: data.expires_at ?? null,
    borrowed: toOptionalNumber(data.borrowed),
    borrowable: toOptionalNumber(data.borrowable),
    unlimited: data.unlimited === true,
  };
}

/** Maps the full response `{ dieline_template_group_list: { dieline_template_groups: [...] } }`. */
export function mapDielineTemplateGroupList(raw: any): DielineTemplateGroup[] {
  const groups = raw?.dieline_template_group_list?.dieline_template_groups;
  return Array.isArray(groups) ? groups.map(mapDielineTemplateGroup) : [];
}

function mapFeatureSlot(raw: any): DielineTemplateFeatureSlot | undefined {
  if (!raw) return undefined;
  return {
    type: raw.type,
    id: raw.id,
    name: raw.name,
    category: raw.category,
    image: raw.image,
  };
}

function mapVariableImage(raw: any): { type: string; url: string | null } | undefined {
  if (!raw) return undefined;
  return { type: raw.type, url: raw.url ?? null };
}

/**
 * Normalizes `default_value`. When it carries `unit` it is a `length` value and the API sometimes
 * returns it as a string (e.g. `{"value": "0.0", "unit": "mm"}`); in that case it is converted to a number.
 * Without `unit` (booleans, etc.) the value is left as is.
 */
function mapDefaultValue(raw: unknown): DielineTemplateVariableDefaultValue | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    return { value: raw as number | string | boolean };
  }
  const obj = raw as Record<string, unknown>;
  const hasUnit = obj.unit !== undefined;
  const value = hasUnit ? toNumber(obj.value) : (obj.value as number | string | boolean);
  return { value, unit: obj.unit as Unit | string | undefined };
}

export function mapDielineTemplateVariable(raw: any): DielineTemplateVariable {
  return {
    type: 'dieline_template_variable',
    name: raw?.name,
    description: raw?.description,
    dataType: raw?.data_type,
    required: Boolean(raw?.required),
    defaultValue: mapDefaultValue(raw?.default_value),
    image: mapVariableImage(raw?.image),
    allowedValues: Array.isArray(raw?.allowed_values) ? raw.allowed_values : undefined,
    children: Array.isArray(raw?.children) ? raw.children.map(mapDielineTemplateVariable) : [],
  };
}

function mapTemplateImage(raw: any): DielineTemplateImage {
  return { type: raw?.type, url: raw?.url ?? null };
}

/** Maps a raw `dieline_template` object (already unwrapped from the `{ dieline_template: ... }` wrapper). */
export function mapDielineTemplate(raw: any): DielineTemplate {
  return {
    type: 'dieline_template',
    id: raw?.id,
    group: mapDielineTemplateGroup(raw?.group ?? {}),
    flap: mapFeatureSlot(raw?.flap),
    topFlap: mapFeatureSlot(raw?.top_flap),
    bottomFlap: mapFeatureSlot(raw?.bottom_flap),
    tuck: mapFeatureSlot(raw?.tuck),
    topTuck: mapFeatureSlot(raw?.top_tuck),
    bottomTuck: mapFeatureSlot(raw?.bottom_tuck),
    dustFlap: mapFeatureSlot(raw?.dust_flap),
    topDustFlap: mapFeatureSlot(raw?.top_dust_flap),
    bottomDustFlap: mapFeatureSlot(raw?.bottom_dust_flap),
    glueFlap: mapFeatureSlot(raw?.glue_flap),
    cover: mapFeatureSlot(raw?.cover),
    hanger: mapFeatureSlot(raw?.hanger),
    hangHole: mapFeatureSlot(raw?.hang_hole),
    style: mapFeatureSlot(raw?.style),
    tags: Array.isArray(raw?.tags) ? raw.tags : [],
    variables: Array.isArray(raw?.variables) ? raw.variables.map(mapDielineTemplateVariable) : [],
    links: mapLinks(raw?.links),
    images: Array.isArray(raw?.images) ? raw.images.map(mapTemplateImage) : [],
  };
}
