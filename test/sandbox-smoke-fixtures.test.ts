import { describe, it, expect } from 'vitest';
import { DielinesClient } from '../src/dielines/client';
import { mockFetchOnce } from './helpers';

function makeClient(fetchImpl: typeof fetch) {
  return new DielinesClient({ apiKey: 'test-dielines-key', environment: 'sandbox', fetchImpl });
}

// Fragments copied from real sandbox responses.
describe('real sandbox response shapes', () => {
  it('createDieline: maps substrate_parts with a null part into substrateParts', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline: {
        type: 'dieline',
        id: 'di_onphnzg5dnoi',
        dieline_template_id: 'becf-11101',
        variables: { unit: 'mm', width: 50, height: 150, length: 100, material: 0.5 },
        format: 'svg',
        url: 'https://example.com/di.svg',
        substrate_parts: [{ part: null, name: 'Material', param: 'substrate' }],
        links: [],
        created_at: '2026-11-16T20:51:07Z',
      },
    });

    const dieline = await makeClient(fetchImpl).createDieline('becf-11101', {
      variables: { unit: 'mm', width: 50, height: 150, length: 100 },
    } as any);

    expect(dieline.substrateParts).toEqual([{ part: null, name: 'Material', param: 'substrate' }]);
  });

  it('createDieline: substrateParts is an empty array when substrate_parts is absent', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline: {
        type: 'dieline',
        id: 'di_1',
        dieline_template_id: 'becf-11101',
        variables: { unit: 'mm' },
        links: [],
      },
    });

    const dieline = await makeClient(fetchImpl).createDieline('becf-11101', {
      variables: { unit: 'mm' },
    } as any);

    expect(dieline.substrateParts).toEqual([]);
  });

  it('calculateNestingEfficiencies: "nesting_template_components": [[]] produces no components', async () => {
    const fetchImpl = mockFetchOnce(200, {
      nesting_template_efficiencies: {
        type: 'nesting_template_efficiencies',
        dieline_id: 'di_onphnzg5dnoi',
        dieline_template_id: 'becf-11101',
        variables: { unit: 'mm', sheet_width: 1000.0, sheet_height: 700.0 },
        efficiencies: {
          lt_lAmyrmg41a: { num_x: 4, num_y: 2, efficiency: { value: 72.96, type: 'percentage' } },
        },
        nesting_templates: [
          {
            type: 'nesting_template',
            id: 'lt_lAmyrmg41a',
            nesting_template_components: [],
            variables: [],
          },
        ],
        nesting_template_components: [[]],
      },
    });

    const result = await makeClient(fetchImpl).calculateNestingEfficiencies('di_onphnzg5dnoi', {
      variables: { unit: 'mm', sheetWidth: 1000, sheetHeight: 700 },
    });

    expect(result.nestingTemplateComponents).toEqual([]);
  });

  it('nesting template components: flattens one nesting level and drops entries without an id', async () => {
    const fetchImpl = mockFetchOnce(200, {
      nesting_template_list: {
        id: 'x',
        dieline_id: 'di_1',
        total: 1,
        nesting_template_components: [
          [{ id: 'lg_1', name: 'Group', category: 'Cartons' }],
          [],
          { id: 'lg_2', name: 'Other', category: 'Cartons' },
          null,
          'junk',
          { name: 'no id' },
        ],
        nesting_templates: [],
      },
    });

    const result = await makeClient(fetchImpl).listNestingTemplates('di_1');

    expect(result.nestingTemplateComponents.map((c) => c.id)).toEqual(['lg_1', 'lg_2']);
    expect(result.nestingTemplateComponents[0]).toEqual({
      type: 'nesting_template_component',
      id: 'lg_1',
      name: 'Group',
      category: 'Cartons',
    });
  });

  it('createNesting: preserves template-specific variables such as blok_x and ignores layout_annotations', async () => {
    const fetchImpl = mockFetchOnce(200, {
      nesting: {
        type: 'nesting',
        id: 'ne_gdlozmujdxh1',
        dieline_id: 'di_onphnzg5dnoi',
        dieline_template_id: 'becf-11101',
        nesting_template_id: 'lt_lAmyrmg41a',
        layout_annotations: { 'Sheet width': '1000 mm', 'On X-axis': 4 },
        variables: {
          unit: 'mm',
          sheet_width: 1000,
          sheet_height: 700,
          sheet_margin_top: 10,
          dimension_texts: false,
          dieline_variables: { unit: 'mm', width: 50, material: 0.5 },
          num_x: 4,
          num_y: 2,
          margin_y: 0.0,
          margin_x: 0.0,
          blok_x: 0.0,
        },
        format: 'svg',
        width: { value: 936.0, unit: 'mm' },
        height: { value: 625.0, unit: 'mm' },
        nesting_overflow: false,
        sum_of_line_lengths: [],
        url: 'https://example.com/ne.svg',
        created_at: '2026-11-16T20:51:07Z',
      },
    });

    const nesting = await makeClient(fetchImpl).createNesting('di_onphnzg5dnoi', 'lt_lAmyrmg41a', {
      variables: { unit: 'mm', sheetWidth: 1000, sheetHeight: 700 },
    });

    expect(nesting.variables.blok_x).toBe(0);
    expect(nesting.variables.sheetWidth).toBe(1000);
    expect(nesting.variables.numX).toBe(4);
    expect(nesting.variables.dielineVariables?.material).toBe(0.5);
    expect(nesting.variables).not.toHaveProperty('sheet_width');
    expect(nesting.variables).not.toHaveProperty('layout_annotations');
    expect(nesting).not.toHaveProperty('layoutAnnotations');
  });
});
