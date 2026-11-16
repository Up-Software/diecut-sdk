import type { Unit } from '../shared/types';

/**
 * Types specific to the Dieline Dimensions API (calculating dimensions/parts without generating
 * files).
 */

/** Flat footprint of a part, in the requested unit. */
export interface PartBoundingBox {
  unit: Unit | string;
  width: number;
  height: number;
}

/** Flat material area of a part (only present when `area: true` is requested). */
export interface PartArea {
  value: number;
  unit: string;
}

/** A part of a dieline (a simple box has a single `"default"` part). */
export interface Part {
  type: 'part';
  id: string;
  name: string;
  category: string;
  boundingBox: PartBoundingBox;
  area?: PartArea;
}

/** Result of `POST /dimensions/{id}/parts`. */
export interface PartListResult {
  id: string;
  dielineTemplateId: string;
  total: number;
  parts: Part[];
}

/**
 * Variables to calculate the parts of a template. `unit` is required; `material` and the
 * remaining variables are specific to each template.
 */
export interface CalculatePartsVariables {
  unit: Unit;
  material?: number;
  [key: string]: number | string | boolean | undefined;
}

/** Parameters for {@link DimensionsClient.calculateParts}. */
export interface CalculatePartsParams {
  variables: CalculatePartsVariables;
  /**
   * If `true`, adds the calculated flat material area to each returned part. Defaults to `false`.
   * Note: the spec documents an example where the response includes `area` even though the request
   * did not set this flag. The flag is transcribed as optional/default false because that is what
   * the field table documents, but the API may include it anyway; see "open questions" #3 of the spec.
   */
  area?: boolean;
}
