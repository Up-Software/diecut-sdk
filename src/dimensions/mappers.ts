import { toNumber } from '../shared/mappers';
import type { Part, PartListResult } from './types';

/** Maps a raw `part` object. */
export function mapPart(raw: any): Part {
  const data = raw ?? {};
  return {
    type: 'part',
    id: data.id,
    name: data.name,
    category: data.category,
    boundingBox: {
      unit: data.bounding_box?.unit,
      width: toNumber(data.bounding_box?.width),
      height: toNumber(data.bounding_box?.height),
    },
    area: data.area ? { value: toNumber(data.area.value), unit: data.area.unit } : undefined,
  };
}

/** Maps the full response of `POST /dimensions/{id}/parts` (`{ part_list: {...} }`). */
export function mapPartListResult(raw: any): PartListResult {
  const list = raw?.part_list ?? {};
  return {
    id: list.id,
    dielineTemplateId: list.dieline_template_id,
    total: toNumber(list.total),
    parts: Array.isArray(list.parts) ? list.parts.map(mapPart) : [],
  };
}
