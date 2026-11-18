/**
 * Types shared between the Dielines API and the Dieline Dimensions API.
 *
 * Both APIs document `dieline_template_group`, `dieline_template` and `dieline_template_variable`
 * with exactly the same shape (same fields, same examples), so they are modeled once here and
 * reused from `src/dielines/types.ts` and `src/dimensions/types.ts`.
 */

/** Unit of measurement used throughout the API: millimeters or inches. */
export type Unit = 'mm' | 'in';

/** HATEOAS link present on almost every resource (`dieline`, `dieline_template`, `3d_mockup`, etc.). */
export interface Link {
  rel: string;
  href: string;
  method: string;
  /** Present on `change_*` links: new value of the feature being changed. */
  name?: string;
}

/**
 * Category of a template group. `"Cartons"`, `"Corrugated Cardboards"` and `"Hard Cardboards"`
 * are documented, but it is left open to other string values (the API may add categories
 * without making this type obsolete).
 */
export type DielineTemplateGroupCategory =
  'Cartons' | 'Corrugated Cardboards' | 'Hard Cardboards' | (string & {});

/** Industry standard code associated with a template or group (e.g. ECMA/FEFCO), with its value. */
export interface DielineTemplateStandardCode {
  type: string;
  value: string;
  /** `true` if the code is an approximate equivalence and not an exact one. */
  approximate: boolean;
}

/** Dieline template group (e.g. "Tuck End Boxes" within the "Cartons" category). */
export interface DielineTemplateGroup {
  type: 'dieline_template_group';
  id: string;
  name: string;
  category: DielineTemplateGroupCategory;
  /** ECMA/FEFCO codes; only present when the group is nested in a `dieline_template` that has them. */
  standardCodes?: DielineTemplateStandardCode[];
}

/**
 * Credit balance of the account (`GET /credits` and `GET /dimensions/credits`).
 * Reading it never spends credits.
 */
export interface Credits {
  type: 'credits';
  /** Product the balance belongs to. */
  product: 'dielines' | 'dimensions' | (string & {});
  /** Active credits (unexpired and unspent). `0` if there are none. */
  available: number;
  /** ISO 8601 UTC expiry of the furthest-out active credit, or `null` when `available` is `0`. */
  expiresAt: string | null;
  /** Dielines only: credits borrowed from next month's allotment. */
  borrowed?: number;
  /** Dielines only: how many more credits can be borrowed once `available` reaches `0`. */
  borrowable?: number;
  /** `true` for accounts with unlimited access; `available: 0` does not mean "empty" then. */
  unlimited: boolean;
}

/**
 * Structural feature slot of a template (`flap`, `tuck`, `dust_flap`, `glue_flap`,
 * `cover`, `hanger`, `hang_hole`, `style`, and their `top_*`/`bottom_*` variants).
 *
 * The documentation only consistently confirms `type`/`id`/`image`; `name`/`category` are
 * included as optional because some examples (e.g. `group`) do carry them, but it is not
 * confirmed for all slots.
 */
export interface DielineTemplateFeatureSlot {
  type: string;
  id: string;
  name?: string;
  category?: string;
  image?: string;
}

/** Data type of a template variable. */
export type DielineTemplateVariableDataType =
  'length' | 'integer' | 'angle' | 'boolean' | 'alignment' | (string & {});

/**
 * Default value of a template variable. For `data_type: "length"` it includes `unit`; for
 * the rest, only `value`. When `unit` is present, `value` is always normalized to `number`
 * (the documentation sometimes shows this field as a string, e.g. `{"value": "0.0", "unit": "mm"}`).
 */
export interface DielineTemplateVariableDefaultValue {
  value: number | string | boolean;
  unit?: Unit | (string & {});
}

/** Reference SVG image of a variable or a template. */
export interface DielineTemplateVariableImage {
  type: string;
  url: string | null;
}

/** Customizable variable of a dieline or nesting template. */
export interface DielineTemplateVariable {
  type: 'dieline_template_variable';
  name: string;
  description?: string;
  dataType: DielineTemplateVariableDataType;
  /** Whether it must be supplied when creating a dieline. Note: even required variables carry `default_value`. */
  required: boolean;
  defaultValue?: DielineTemplateVariableDefaultValue;
  image?: DielineTemplateVariableImage;
  allowedValues?: Array<string | number | boolean>;
  children: DielineTemplateVariable[];
}

/** Preview image of a template (`images[]`). */
export interface DielineTemplateImage {
  type: string;
  url: string | null;
}

/**
 * Dieline template. Identical structure in the Dielines API and the Dieline Dimensions API
 * (the Dimensions API could not document the JSON verbatim due to a crawling tool limitation,
 * but the spec reconstructed the same shape field by field).
 */
export interface DielineTemplate {
  type: 'dieline_template';
  id: string;
  group: DielineTemplateGroup;
  flap?: DielineTemplateFeatureSlot;
  topFlap?: DielineTemplateFeatureSlot;
  bottomFlap?: DielineTemplateFeatureSlot;
  tuck?: DielineTemplateFeatureSlot;
  topTuck?: DielineTemplateFeatureSlot;
  bottomTuck?: DielineTemplateFeatureSlot;
  dustFlap?: DielineTemplateFeatureSlot;
  topDustFlap?: DielineTemplateFeatureSlot;
  bottomDustFlap?: DielineTemplateFeatureSlot;
  glueFlap?: DielineTemplateFeatureSlot;
  cover?: DielineTemplateFeatureSlot;
  hanger?: DielineTemplateFeatureSlot;
  hangHole?: DielineTemplateFeatureSlot;
  style?: DielineTemplateFeatureSlot;
  tags: string[];
  variables: DielineTemplateVariable[];
  links: Link[];
  images: DielineTemplateImage[];
}
