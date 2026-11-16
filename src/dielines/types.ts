import type {
  Unit,
  Link,
  DielineTemplate,
  DielineTemplateVariable,
  DielineTemplateImage,
  DielineTemplateStandardCode,
} from '../shared/types';

/**
 * Types specific to the Dielines API (dieline generation, 3D mockups and nesting).
 */

/** File format supported for dielines and nestings. */
export type DielineFormat = 'pdf' | 'dxf' | 'svg';

/**
 * Materials/substrates available for 3D mockups. Modeled as a union of string literals
 * (not as a TS enum) so it is easy to extend if the API adds new values without breaking the
 * type (any other string is accepted in addition to the documented ones).
 */
export type Substrate =
  | 'black_embossedpaper'
  | 'black_hardcardboards'
  | 'corrugated_brown'
  | 'corrugated_white'
  | 'gray_hardcardboards'
  | 'kraft_brown'
  | 'kraft_hardcardboards'
  | 'white_embossedpaper'
  | 'white_hardcardboards'
  | 'white_sbs'
  | (string & {});

/**
 * Variables of a dieline. `unit` and `material` are explicitly typed because they are common to
 * all templates; the remaining keys are specific to each template (`length`,
 * `width`, `height`, `top_tuck_flap`, `overflow`, etc.) and are passed as documented by
 * `dieline_template.variables[].name`.
 */
export interface DielineVariables {
  unit: Unit;
  material?: number;
  [key: string]: number | string | boolean | undefined;
}

/** Recommended artwork dimensions for uploading a 3D mockup. Always normalized to `number`. */
export interface DielineArtworkDimensions {
  unit: Unit | string;
  width: number;
  height: number;
}

/**
 * A part a dieline accepts a substrate for (from `substrate_parts` on the dieline response).
 * `part: null` is the body/main material, whose `param` is `substrate`; numbered parts of
 * multi-part dielines give the exact `param` to send (for example in `partSubstrates`).
 */
export interface DielineSubstratePart {
  part: number | null;
  name: string;
  param: string;
}

/** Calculated area of a dieline (only present if `area: true` was requested, and only for Cartons/Corrugated). */
export interface DielineArea {
  unit: string;
  value: number;
}

/**
 * Convenience actions exposed on a {@link Dieline}, one for each `rel` present in its
 * `links` array (`create_3d_mockup`, `list_nesting_templates`, `calculate_nesting_efficiencies`).
 * They avoid having to repeat `dieline.id` by hand when chaining the next call.
 */
export interface DielineActions {
  /** Uploads artwork and generates a 3D mockup for this dieline (link `create_3d_mockup`). Does not consume quota. */
  create3DMockup(params: Create3DMockupParams): Promise<ThreeDMockup>;
  /** Lists the nesting templates compatible with this dieline (link `list_nesting_templates`). Does not consume quota. */
  listNestingTemplates(): Promise<NestingTemplateListResult>;
  /** Calculates nesting efficiencies for this dieline (link `calculate_nesting_efficiencies`). Does not consume quota. */
  calculateNestingEfficiencies(
    params: NestingEfficienciesParams,
  ): Promise<NestingTemplateEfficiencies>;
}

/**
 * Dieline generated from a template.
 *
 * Design note (see the spec's "Cross-Cutting Notes", point about the `Dieline` object): the object page
 * suggests `unit`/`material` as top-level fields, but **all** real JSON examples
 * nest them inside `variables`. This type reflects the shape observed in the examples
 * (`variables.unit`, `variables.material`), not that of the standalone object page.
 *
 * Instances returned by {@link DielinesClient} are immutable (`Object.freeze`) and include the
 * {@link DielineActions} to chain the next call without repeating `id`.
 */
export interface Dieline extends DielineActions {
  type: 'dieline';
  id: string;
  dielineTemplateId: string;
  variables: DielineVariables;
  format: DielineFormat;
  url: string;
  artworkDimensions?: DielineArtworkDimensions;
  area?: DielineArea;
  /** Area breakdown per part, for multi-part dielines. Shape not detailed in the spec. */
  partAreas?: Record<string, unknown>;
  /** Parts of the dieline that accept a substrate for 3D mockups. Empty when the API does not return them. */
  substrateParts: DielineSubstratePart[];
  links: Link[];
  createdAt?: string;
}

/** Page of results for `GET /dieline-templates/{id}/dielines`. */
export interface DielineListPage {
  /** Template the dielines were generated from. */
  dielineTemplateId?: string;
  total: number;
  page: number;
  pageSize: number;
  dielines: Dieline[];
  /** Navigation links (`self`, `previous_page`, `next_page`), when the API returns them. */
  links: Link[];
  /** `true` if there is a next page (`next_page` link or, without links, `page * pageSize < total`). */
  hasNextPage: boolean;
}

/** Convenience actions on a {@link ThreeDMockup}, one for each `rel` of its `links` array. */
export interface ThreeDMockupActions {
  /** Updates this 3D mockup (link `update`). Does not consume quota. */
  update(params: Update3DMockupParams): Promise<ThreeDMockup>;
  /** Deletes this 3D mockup (link `delete`). Does not consume quota. */
  delete(): Promise<void>;
}

/**
 * 3D mockup generated from a dieline and an artwork file.
 *
 * Instances returned by {@link DielinesClient} are immutable (`Object.freeze`) and include the
 * {@link ThreeDMockupActions} so `dielineId`/`id` do not have to be repeated by hand.
 */
export interface ThreeDMockup extends ThreeDMockupActions {
  type: '3d_mockup';
  id: string;
  url: string;
  name?: string;
  dieline: Dieline;
  links: Link[];
  createdAt?: string;
}

/**
 * Page of results for `GET /dielines/{dieline_id}/3d-mockups`.
 *
 * Design note (the spec's "Field-name gotcha"): the real JSON key is `"3d_mockups"` (it starts with
 * a digit, so it is not a valid TS identifier); it is exposed here as `threeDMockups`.
 */
export interface ThreeDMockupListPage {
  total: number;
  page: number;
  pageSize: number;
  dielineId: string;
  threeDMockups: ThreeDMockup[];
  /** Navigation links (`self`, `previous_page`, `next_page`). */
  links: Link[];
  /** `true` if there is a next page (`next_page` link or, without links, `page * pageSize < total`). */
  hasNextPage: boolean;
}

/** Component of a nesting template (e.g. "Hard cardboard of the box"). */
export interface NestingTemplateComponent {
  type: 'nesting_template_component';
  id: string;
  name: string;
  category: string;
}

/** Convenience action on a {@link NestingTemplate}, based on its `create_nesting` link. */
export interface NestingTemplateActions {
  /** Generates a nesting from this template, for the dieline it was listed from (link `create_nesting`). */
  createNesting(params: CreateNestingParams): Promise<Nesting>;
}

/**
 * Nesting template (sheet layout) compatible with a dieline.
 *
 * Instances returned by {@link DielinesClient} are immutable (`Object.freeze`) and include
 * {@link NestingTemplateActions.createNesting} so `dielineId`/`id` do not have to be repeated by hand.
 */
export interface NestingTemplate extends NestingTemplateActions {
  type: 'nesting_template';
  id: string;
  /** Documented on the object page but not confirmed in real JSON examples of Endpoint 9/10. */
  dielineTemplateId?: string;
  nestingTemplateComponents: NestingTemplateComponent[];
  variables: DielineTemplateVariable[];
  images: DielineTemplateImage[];
  links: Link[];
}

/** Result of `GET /dielines/{dieline_id}/nesting-templates`. */
export interface NestingTemplateListResult {
  id: string;
  dielineId: string;
  dielineTemplateId: string;
  total: number;
  nestingTemplateComponents: NestingTemplateComponent[];
  nestingTemplates: NestingTemplate[];
}

/** Nesting efficiency calculated for a specific template. */
export interface NestingEfficiency {
  numX: number;
  numY: number;
  efficiency: { value: number; type: string };
}

/**
 * Result of `POST /dielines/{dieline_id}/nesting-template-efficiencies`.
 *
 * `efficiencies` is a map whose values can be `null` when a template has no calculable
 * efficiency data (see the `"lg_xyz789abc": null` example in the spec).
 */
export interface NestingTemplateEfficiencies {
  dielineId: string;
  dielineTemplateId: string;
  variables: Record<string, unknown>;
  efficiencies: Record<string, NestingEfficiency | null>;
  nestingTemplates: NestingTemplate[];
  nestingTemplateComponents: NestingTemplateComponent[];
}

/** `sum_of_line_lengths` entry in a `Nesting` (e.g. `Cut`, `Crease`, `Total`). */
export interface NestingLineLength {
  name: string;
  unit: string;
  value: number;
}

/** Variables returned inside a `Nesting`, including the nested variables of the original dieline. */
export interface NestingVariables {
  unit: Unit;
  sheetWidth: number;
  sheetHeight: number;
  sheetMarginTop?: number;
  sheetMarginBottom?: number;
  sheetMarginSide?: number;
  dimensionTexts?: boolean;
  numX?: number;
  numY?: number;
  marginX?: number;
  marginY?: number;
  dielineVariables?: DielineVariables;
  [key: string]: unknown;
}

/** Result of `POST /dielines/{dieline_id}/nestings/{nesting_template_id}`. */
export interface Nesting {
  type: 'nesting';
  id: string;
  dielineId: string;
  dielineTemplateId: string;
  nestingTemplateId: string;
  variables: NestingVariables;
  format: DielineFormat;
  width: { value: number; unit: string };
  height: { value: number; unit: string };
  nestingOverflow: boolean;
  sumOfLineLengths: NestingLineLength[];
  url: string;
  createdAt?: string;
}

// ---------------------------------------------------------------------------------------------
// Parameter types for DielinesClient methods
// ---------------------------------------------------------------------------------------------

/** Parameters for {@link DielinesClient.createDieline}. */
export interface CreateDielineParams {
  format: DielineFormat;
  /** Adds a header with the template variables to the PDF. Defaults to `true`. */
  pdfHeader?: boolean;
  /** Calculates the dieline area (Cartons/Corrugated only). Defaults to `false`. */
  area?: boolean;
  /** Includes dimension texts with arrows. Defaults to `true`. */
  dimensionTexts?: boolean;
  variables: DielineVariables;
}

/** Parameters for {@link DielinesClient.create3DMockup}. */
export interface Create3DMockupParams {
  /** Artwork file: PNG, JPEG, JPG, SVG or PDF. */
  file: Buffer | Blob;
  /** File name to use in the multipart body, if `file` is a `Buffer`. */
  fileName?: string;
  /** Content-Type of the file, if `file` is a `Buffer`. */
  contentType?: string;
  name?: string;
  /** `true` (default) = artwork for the outside of the box; `false` = inside. */
  outsideDesign?: boolean;
  /** Background color of the 3D scene, in hex (e.g. `"#707070"`). */
  sceneBackgroundColor?: string;
  substrate?: Substrate;
  /** Map of part number → substrate, for multi-part/multi-material boxes. */
  partSubstrates?: Record<string, string>;
}

/** Parameters for {@link DielinesClient.update3DMockup}: same shape as create, everything optional. */
export type Update3DMockupParams = Partial<Create3DMockupParams>;

/** Variables for `POST /dielines/{dieline_id}/nesting-template-efficiencies`. */
export interface NestingEfficienciesVariables {
  unit: Unit;
  sheetWidth: number;
  sheetHeight: number;
  /** Defaults to `0`. */
  sheetMarginTop?: number;
  /** Defaults to `0`. */
  sheetMarginBottom?: number;
  /** Defaults to `0`. */
  sheetMarginSide?: number;
}

/** Parameters for {@link DielinesClient.calculateNestingEfficiencies}. */
export interface NestingEfficienciesParams {
  variables: NestingEfficienciesVariables;
}

/**
 * Variables for `POST /dielines/{dieline_id}/nestings/{nesting_template_id}`. In addition to the known
 * sheet fields, it accepts nesting-template-specific variables (e.g. `margin_x`,
 * `margin_y`) passed as documented by `nesting_template.variables[].name`.
 */
export interface CreateNestingVariables {
  unit: Unit;
  sheetWidth: number;
  sheetHeight: number;
  sheetMarginTop?: number;
  sheetMarginBottom?: number;
  sheetMarginSide?: number;
  /** Number of dielines along the x axis; computed automatically if omitted. */
  numX?: number;
  /** Number of dielines along the y axis; computed automatically if omitted. */
  numY?: number;
  [key: string]: number | string | boolean | undefined;
}

/** Parameters for {@link DielinesClient.createNesting}. */
export interface CreateNestingParams {
  format: DielineFormat;
  /** Defaults to `true`. */
  pdfHeader?: boolean;
  /** Defaults to `true`. */
  dimensionTexts?: boolean;
  variables: CreateNestingVariables;
}

export type { DielineTemplateStandardCode };

/**
 * Summary of a template as returned by `GET /dieline-templates` without `expand`. Includes the
 * images (PNG `small`/`large` and an SVG) and the links (`dieline_template` per unit and `web`).
 */
export interface DielineTemplateSummary {
  type: 'dieline_template_summary';
  id: string;
  groupId: string;
  standardCodes?: DielineTemplateStandardCode[];
  images: DielineTemplateImage[];
  links: Link[];
}

/** Parameters for `listTemplates` without expanding: the items are {@link DielineTemplateSummary}. */
export interface ListTemplatesParams {
  /** Group slug (e.g. `cartons_tuck_end_boxes`), as returned by `listTemplateGroups`. */
  groupId?: string;
  /** Page number, starting at 1. API default: 1. */
  page?: number;
  /** Items per page, between 1 and 100. API default: 25. */
  pageSize?: number;
  /** If `true`, the items are full templates and `unit` is required. */
  expand?: boolean;
  /** Unit of the default values; required when `expand` is `true`. */
  unit?: Unit;
}

/** Parameters for `listTemplates` with `expand: true`: `unit` is required. */
export interface ListTemplatesExpandedParams extends ListTemplatesParams {
  expand: true;
  unit: Unit;
}

/** Parameters for `listTemplates` without expanding (`expand` absent or `false`). */
export interface ListTemplatesSummaryParams extends ListTemplatesParams {
  expand?: false;
}

/** Page of results for `GET /dieline-templates`; `T` depends on whether `expand` was requested. */
export interface DielineTemplateListPage<T = DielineTemplateSummary> {
  total: number;
  page: number;
  pageSize: number;
  dielineTemplates: T[];
  links: Link[];
  /** `true` if there is a next page (`next_page` link or, without links, `page * pageSize < total`). */
  hasNextPage: boolean;
}

/** Type of item of {@link DielineTemplateListPage} according to the parameters. */
export type ListTemplatesItem<P extends ListTemplatesParams> = P extends { expand: true }
  ? DielineTemplate
  : DielineTemplateSummary;
