import { describe, it, expect } from 'vitest';
import { DielinesClient } from '../src/dielines/client';
import {
  mapDielineTemplateListPage,
  mapDielineTemplateSummary,
  mapNesting,
  mapNestingTemplateEfficiencies,
  mapNestingTemplateListResult,
  mapThreeDMockup,
  mapThreeDMockupListPage,
} from '../src/dielines/mappers';
import { mapPart } from '../src/dimensions/mappers';
import { mapCredits, mapDielineTemplateVariable, mapUnit } from '../src/shared/mappers';

// Responses that are empty, missing or not wrapped must map to safe defaults instead of throwing.
const client = new DielinesClient({
  apiKey: 'k',
  fetchImpl: (() => {}) as unknown as typeof fetch,
});

describe('shared mappers', () => {
  it('keeps "in" and falls back to "mm" for any other unit', () => {
    expect(mapUnit('in')).toBe('in');
    expect(mapUnit('cm')).toBe('mm');
    expect(mapUnit(undefined)).toBe('mm');
  });

  it('maps credits that arrive without the "credits" wrapper or not at all', () => {
    expect(mapCredits({ product: 'dielines', available: 7 })).toMatchObject({
      type: 'credits',
      product: 'dielines',
      available: 7,
      expiresAt: null,
      unlimited: false,
    });
    expect(mapCredits(undefined)).toMatchObject({
      type: 'credits',
      expiresAt: null,
      unlimited: false,
    });
  });

  it('keeps a primitive default value and maps an image without url', () => {
    const variable = mapDielineTemplateVariable({
      name: 'glue_flap',
      default_value: true,
      image: { type: 'svg' },
    });
    expect(variable.defaultValue).toEqual({ value: true });
    expect(variable.image).toEqual({ type: 'svg', url: null });
    expect(variable.children).toEqual([]);
  });
});

describe('dielines mappers with missing data', () => {
  it('maps a missing 3D mockup and an empty mockup list', () => {
    expect(mapThreeDMockup(client, undefined)).toMatchObject({ type: '3d_mockup' });
    const page = mapThreeDMockupListPage(client, undefined);
    expect(page.threeDMockups).toEqual([]);
    expect(page.links).toEqual([]);
    expect(page.hasNextPage).toBe(false);
  });

  it('maps an empty nesting template list', () => {
    const result = mapNestingTemplateListResult(client, undefined);
    expect(result.nestingTemplates).toEqual([]);
    expect(result.nestingTemplateComponents).toEqual([]);
  });

  it('maps empty nesting efficiencies', () => {
    expect(mapNestingTemplateEfficiencies(client, undefined).efficiencies).toEqual({});
  });

  it('maps a missing nesting', () => {
    const nesting = mapNesting(undefined);
    expect(nesting.type).toBe('nesting');
    expect(nesting.nestingOverflow).toBe(false);
    expect(nesting.sumOfLineLengths).toEqual([]);
  });

  it('maps a template summary without images', () => {
    expect(mapDielineTemplateSummary({ id: 'becf-11101' })).toMatchObject({
      id: 'becf-11101',
      images: [],
      standardCodes: undefined,
    });
  });

  it('maps a template list that arrives without the wrapper or not at all', () => {
    const unwrapped = mapDielineTemplateListPage(
      { total: 1, page: 1, page_size: 25, dieline_templates: [{ id: 'becf-11101' }] },
      false,
    );
    expect(unwrapped.dielineTemplates.map((t) => t.id)).toEqual(['becf-11101']);
    expect(mapDielineTemplateListPage(undefined, false).dielineTemplates).toEqual([]);
  });
});

describe('dimensions mappers with missing data', () => {
  it('maps a missing part', () => {
    expect(mapPart(undefined)).toMatchObject({ type: 'part' });
  });
});
