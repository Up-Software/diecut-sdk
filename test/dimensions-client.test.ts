import { describe, it, expect } from 'vitest';
import { DimensionsClient } from '../src/dimensions/client';
import { DiecutValidationError, DiecutAuthError } from '../src/errors';
import { mockFetchOnce } from './helpers';

const API_KEY = 'dim_test_key';

function makeClient(fetchImpl: typeof fetch) {
  return new DimensionsClient({ apiKey: API_KEY, fetchImpl });
}

describe('DimensionsClient', () => {
  it('listTemplateGroups: uses /dimensions/template-groups (not /docs/dimensions-api/...) and maps the list', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline_template_group_list: {
        type: 'dieline_template_group_list',
        dieline_template_groups: [
          {
            type: 'dieline_template_group',
            id: 'cartons_food_boxes',
            name: 'Food Boxes',
            category: 'Cartons',
          },
          {
            type: 'dieline_template_group',
            id: 'corrugated_cardboards_tray_boxes',
            name: 'Tray Boxes',
            category: 'Corrugated Cardboards',
          },
        ],
      },
    });
    const client = makeClient(fetchImpl);

    const groups = await client.listTemplateGroups();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.diecuttemplates.com/dimensions/template-groups');
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(init.headers['Dimensions-Api-Version']).toBe('1.0');
    expect(groups).toHaveLength(2);
    expect(groups[1].category).toBe('Corrugated Cardboards');
  });

  it('getTemplate: uses unit "mm" by default and builds /dimensions/{id}?unit=mm', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline_template: {
        type: 'dieline_template',
        id: 'becf-10301',
        group: {
          type: 'dieline_template_group',
          id: 'cartons_tuck_end_boxes',
          name: 'Tuck End Boxes',
          category: 'Cartons',
        },
        flap: { type: 'flap', id: 'uni_tuck_flap' },
        tuck: { type: 'tuck', id: 'sit_lock_tuck' },
        dust_flap: { type: 'dust_flap', id: 'slit_lock_dust_flap' },
        hang_hole: { type: 'hang_hole', id: 'triangle_hang_hole' },
        tags: [],
        variables: [
          {
            type: 'dieline_template_variable',
            name: 'length',
            description: 'length',
            data_type: 'length',
            required: true,
            default_value: { value: 3.937, unit: 'in' },
            image: { type: 'svg', url: 'https://example.com/length.svg' },
            children: [],
          },
        ],
        links: [{ rel: 'self', href: '/dieline-templates/in/becf-10301', method: 'GET' }],
        images: [{ type: 'svg', url: 'https://example.com/preview.svg' }],
      },
    });
    const client = makeClient(fetchImpl);

    const template = await client.getTemplate('becf-10301');

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.diecuttemplates.com/dimensions/becf-10301?unit=mm');
    expect(template.id).toBe('becf-10301');
    expect(template.flap?.id).toBe('uni_tuck_flap');
    expect(template.variables[0].defaultValue).toEqual({ value: 3.937, unit: 'in' });
  });

  it('getTemplate: allows passing an explicit unit ("in")', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline_template: {
        type: 'dieline_template',
        id: 'becf-11a02',
        group: {
          type: 'dieline_template_group',
          id: 'cartons_food_boxes',
          name: 'Food Boxes',
          category: 'Cartons',
        },
        tags: [],
        variables: [],
        links: [],
        images: [],
      },
    });
    const client = makeClient(fetchImpl);

    await client.getTemplate('becf-11a02', 'in');

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.diecuttemplates.com/dimensions/becf-11a02?unit=in');
  });

  it('calculateParts: uses /dimensions/{id}/parts, serializes variables/area and maps part_list', async () => {
    const fetchImpl = mockFetchOnce(200, {
      part_list: {
        type: 'part_list',
        id: 'dm_9f2a1c7b4e10',
        dieline_template_id: 'becf-11a02',
        total: 1,
        parts: [
          {
            type: 'part',
            id: 'default',
            name: 'default',
            category: 'carton',
            bounding_box: { unit: 'mm', width: 280.0, height: 180.0 },
            area: { value: 48847.29, unit: 'mm2' },
          },
        ],
      },
    });
    const client = makeClient(fetchImpl);

    const result = await client.calculateParts('becf-11a02', {
      variables: { unit: 'mm', material: 0.5, length: 200.0, width: 100.0, height: 40.0 },
      area: true,
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.diecuttemplates.com/dimensions/becf-11a02/parts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      variables: { unit: 'mm', material: 0.5, length: 200.0, width: 100.0, height: 40.0 },
      area: true,
    });

    expect(result.id).toBe('dm_9f2a1c7b4e10');
    expect(result.dielineTemplateId).toBe('becf-11a02');
    expect(result.total).toBe(1);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toEqual({
      type: 'part',
      id: 'default',
      name: 'default',
      category: 'carton',
      boundingBox: { unit: 'mm', width: 280, height: 180 },
      area: { value: 48847.29, unit: 'mm2' },
    });
  });

  it('calculateParts: validation 400 throws DiecutValidationError', async () => {
    const fetchImpl = mockFetchOnce(400, {
      message: 'Validation failed for one or more variables.',
      errors: [{ message: "Invalid 'unit'. Valid 'unit' values are 'mm' and 'in'." }],
    });
    const client = makeClient(fetchImpl);

    await expect(
      client.calculateParts('becf-11a02', { variables: { unit: 'mm' as any } }),
    ).rejects.toBeInstanceOf(DiecutValidationError);
  });

  it('calculateParts: 403 without credits throws DiecutAuthError', async () => {
    const fetchImpl = mockFetchOnce(403, {
      message: 'Forbidden. Available Dieline Dimensions API credits count = 0',
      errors: [],
    });
    const client = makeClient(fetchImpl);

    const promise = client.calculateParts('becf-11a02', { variables: { unit: 'mm' } });
    await expect(promise).rejects.toBeInstanceOf(DiecutAuthError);
    try {
      await promise;
    } catch (error) {
      expect((error as DiecutAuthError).message).toBe(
        'Forbidden. Available Dieline Dimensions API credits count = 0',
      );
    }
  });
});
