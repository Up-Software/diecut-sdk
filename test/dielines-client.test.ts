import { describe, it, expect } from 'vitest';
import { DielinesClient } from '../src/dielines/client';
import { DiecutValidationError, DiecutNotFoundError } from '../src/errors';
import { mockFetchOnce } from './helpers';

const API_KEY = 'test-dielines-key';

function makeClient(fetchImpl: typeof fetch) {
  return new DielinesClient({
    apiKey: API_KEY,
    environment: 'sandbox',
    fetchImpl,
    minRequestIntervalMs: 0,
  });
}

describe('DielinesClient', () => {
  it('listTemplateGroups: builds the request and maps dieline_template_group_list', async () => {
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
            id: 'cartons_tuck_end_boxes',
            name: 'Tuck End Boxes',
            category: 'Cartons',
          },
        ],
      },
    });
    const client = makeClient(fetchImpl);

    const groups = await client.listTemplateGroups();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sandbox.api.diecuttemplates.com/dieline-template-groups');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(init.headers['Dielines-Api-Version']).toBe('1.0');
    expect(groups).toHaveLength(2);
    expect(groups[1]).toEqual({
      type: 'dieline_template_group',
      id: 'cartons_tuck_end_boxes',
      name: 'Tuck End Boxes',
      category: 'Cartons',
    });
  });

  it('getTemplate: builds /dieline-templates/{unit}/{id} and maps flap/tuck/dust_flap/hang_hole and variables', async () => {
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
        flap: { type: 'flap', id: 'uni_tuck_flap', image: 'https://example.com/flap.png' },
        tuck: { type: 'tuck', id: 'sit_lock_tuck', image: 'https://example.com/tuck.png' },
        dust_flap: {
          type: 'dust_flap',
          id: 'slit_lock_dust_flap',
          image: 'https://example.com/dust_flap.png',
        },
        hang_hole: {
          type: 'hang_hole',
          id: 'triangle_hang_hole',
          image: 'https://example.com/hang_hole.png',
        },
        tags: [],
        variables: [
          {
            type: 'dieline_template_variable',
            name: 'length',
            description: 'length',
            data_type: 'length',
            required: true,
            default_value: { value: 3.937, unit: 'in' },
            children: [],
          },
          {
            type: 'dieline_template_variable',
            name: 'overflow',
            description: 'overflow',
            data_type: 'boolean',
            required: false,
            default_value: { value: false },
            allowed_values: [true, false, 0, 1],
            children: [],
          },
        ],
        links: [{ rel: 'self', href: '/dieline-templates/in/becf-10301', method: 'GET' }],
        images: [{ type: 'svg', url: 'https://example.com/preview.svg' }],
      },
    });
    const client = makeClient(fetchImpl);

    const template = await client.getTemplate('becf-10301', 'in');

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sandbox.api.diecuttemplates.com/dieline-templates/in/becf-10301');
    expect(template.id).toBe('becf-10301');
    expect(template.flap).toEqual({
      type: 'flap',
      id: 'uni_tuck_flap',
      name: undefined,
      category: undefined,
      image: 'https://example.com/flap.png',
    });
    expect(template.tuck?.id).toBe('sit_lock_tuck');
    expect(template.dustFlap?.id).toBe('slit_lock_dust_flap');
    expect(template.hangHole?.id).toBe('triangle_hang_hole');
    expect(template.variables[0]).toMatchObject({
      name: 'length',
      dataType: 'length',
      required: true,
      defaultValue: { value: 3.937, unit: 'in' },
    });
    expect(template.variables[1]).toMatchObject({
      name: 'overflow',
      dataType: 'boolean',
      required: false,
      defaultValue: { value: false },
    });
  });

  it('getTemplate: 404 throws DiecutNotFoundError', async () => {
    const fetchImpl = mockFetchOnce(404, { message: 'Resource cannot be found' });
    const client = makeClient(fetchImpl);
    await expect(client.getTemplate('does-not-exist', 'mm')).rejects.toBeInstanceOf(
      DiecutNotFoundError,
    );
  });

  it('createDieline: serializes the body and maps the response, normalizing artwork_dimensions and area (strings -> number)', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline: {
        type: 'dieline',
        id: 'di_ueipnpyp0rlw',
        dieline_template_id: 'becf-10301',
        variables: {
          unit: 'mm',
          length: 251.13,
          width: 102,
          height: 253,
          material: 2.22,
          dimension_texts: true,
        },
        format: 'pdf',
        url: 'https://example.com/dieline.pdf',
        artwork_dimensions: { unit: 'mm', width: '723.06', height: '502.44' },
        area: { unit: 'mm2', value: '11723.06' },
        links: [
          { rel: 'create_3d_mockup', href: '/dielines/di_ueipnpyp0rlw/3d-mockups', method: 'POST' },
          {
            rel: 'list_nesting_templates',
            href: '/dielines/di_ueipnpyp0rlw/nesting-templates',
            method: 'GET',
          },
        ],
        created_at: '2024-12-18T19:27:22Z',
      },
    });
    const client = makeClient(fetchImpl);

    const dieline = await client.createDieline('becf-10301', {
      format: 'pdf',
      area: true,
      variables: {
        unit: 'in',
        material: 0.11,
        length: 4.25,
        width: 3.0,
        height: 5.0,
        top_tuck_flap: 0.53,
      },
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://sandbox.api.diecuttemplates.com/dieline-templates/becf-10301/dielines',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      format: 'pdf',
      pdf_header: undefined,
      area: true,
      dimension_texts: undefined,
      variables: {
        unit: 'in',
        material: 0.11,
        length: 4.25,
        width: 3.0,
        height: 5.0,
        top_tuck_flap: 0.53,
      },
    });

    expect(dieline.id).toBe('di_ueipnpyp0rlw');
    expect(dieline.variables.material).toBe(2.22);
    expect(dieline.artworkDimensions).toEqual({ unit: 'mm', width: 723.06, height: 502.44 });
    expect(dieline.area).toEqual({ unit: 'mm2', value: 11723.06 });
    expect(typeof dieline.artworkDimensions?.width).toBe('number');
    expect(typeof dieline.area?.value).toBe('number');
  });

  it('createDieline: 400 with errors[] (including nested suggestion) throws DiecutValidationError', async () => {
    const fetchImpl = mockFetchOnce(400, {
      message: 'Validation failed for one or more variables.',
      errors: [
        {
          message:
            'The application expects the dimensions to be given in order of Length, Width and Height. A and B should swap places.',
          suggestion: { suggestion: { type: 'swap_values', names: ['a', 'b'] } },
        },
      ],
    });
    const client = makeClient(fetchImpl);

    const promise = client.createDieline('becf-10301', {
      format: 'pdf',
      variables: { unit: 'mm', a: 5, b: 10 },
    });
    await expect(promise).rejects.toBeInstanceOf(DiecutValidationError);
    try {
      await promise;
    } catch (error) {
      const validationError = error as DiecutValidationError;
      expect(validationError.errors[0].suggestion?.suggestion?.type).toBe('swap_values');
    }
  });

  it('listDielines: paginates with page/page_size and maps dieline_list.dielines', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline_list: {
        type: 'dieline_list',
        dieline_template_id: 'becf-10301',
        total: 5,
        page: 2,
        page_size: 2,
        dielines: [
          {
            type: 'dieline',
            id: 'wglf0haqdbil',
            dieline_template_id: 'becf-10301',
            variables: {
              unit: 'mm',
              width: 103,
              height: 253,
              length: 251.14,
              material: 2.22,
              overflow: true,
            },
            format: 'pdf',
            url: 'https://example.com/a.pdf',
            artwork_dimensions: { unit: 'mm', width: '723.06', height: '502.44' },
            created_at: '2024-12-19T15:49:08Z',
          },
        ],
      },
      links: [{ rel: 'self', href: '/dielines/becf-10301?page=2&page_size=2', method: 'GET' }],
    });
    const client = makeClient(fetchImpl);

    const page = await client.listDielines('becf-10301', { page: 2, pageSize: 2 });

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://sandbox.api.diecuttemplates.com/dieline-templates/becf-10301/dielines?page=2&page_size=2',
    );
    expect(page.total).toBe(5);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(2);
    expect(page.dielines).toHaveLength(1);
    expect(page.dielines[0].id).toBe('wglf0haqdbil');
    expect(page.dielines[0].variables.overflow).toBe(true);
    expect(page.dielines[0].artworkDimensions).toEqual({
      unit: 'mm',
      width: 723.06,
      height: 502.44,
    });
  });

  it('create3DMockup: builds multipart with file/name/outside_design and maps the response', async () => {
    const fetchImpl = mockFetchOnce(200, {
      '3d_mockup': {
        type: '3d_mockup',
        id: 'llnmb1oh8r',
        url: 'https://www.diecuttemplates.com/3d/llnmb1oh8r',
        name: 'My design',
        dieline: {
          type: 'dieline',
          id: 'ueipnpyp0rlw',
          dieline_template_id: 'becf-10301',
          variables: { unit: 'mm', length: 250.0, width: 200.0, height: 200.0, material: 0.389 },
          format: 'pdf',
          url: 'https://example.com/dieline.pdf',
          artwork_dimensions: { unit: 'mm', width: '723.06', height: '502.44' },
          created_at: '2024-12-18T19:27:22Z',
        },
        links: [
          { rel: 'update', href: '/dielines/ueipnpyp0rlw/3d-mockups/llnmb1oh8r', method: 'PUT' },
          { rel: 'delete', href: '/dielines/ueipnpyp0rlw/3d-mockups/llnmb1oh8r', method: 'DELETE' },
        ],
      },
    });
    const client = makeClient(fetchImpl);

    const mockup = await client.create3DMockup('di_fwe4iu3vngty', {
      file: Buffer.from('fake-png-bytes'),
      fileName: 'artwork.png',
      contentType: 'image/png',
      name: 'my design',
      outsideDesign: false,
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sandbox.api.diecuttemplates.com/dielines/di_fwe4iu3vngty/3d-mockups');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get('name')).toBe('my design');
    expect(form.get('outside_design')).toBe('false');
    const file = form.get('file') as unknown as Blob;
    expect(file).toBeInstanceOf(Blob);

    expect(mockup.id).toBe('llnmb1oh8r');
    expect(mockup.dieline.id).toBe('ueipnpyp0rlw');
    expect(mockup.dieline.variables.material).toBe(0.389);
  });

  it('update3DMockup: PUT with partial params', async () => {
    const fetchImpl = mockFetchOnce(200, {
      '3d_mockup': {
        type: '3d_mockup',
        id: 'llnmb1oh8r',
        url: 'https://www.diecuttemplates.com/3d/llnmb1oh8r',
        name: 'My design',
        dieline: {
          type: 'dieline',
          id: 'ueipnpyp0rlw',
          dieline_template_id: 'becf-10301',
          variables: { unit: 'mm', length: 250.0, width: 200.0, height: 200.0, material: 0.389 },
          format: 'pdf',
          url: 'https://example.com/dieline.pdf',
        },
        links: [],
      },
    });
    const client = makeClient(fetchImpl);

    await client.update3DMockup('di_fwe4iu3vngty', 'llnmb1oh8r', { substrate: 'kraft_brown' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://sandbox.api.diecuttemplates.com/dielines/di_fwe4iu3vngty/3d-mockups/llnmb1oh8r',
    );
    expect(init.method).toBe('PUT');
    const form = init.body as FormData;
    expect(form.get('substrate')).toBe('kraft_brown');
    expect(form.get('file')).toBeNull();
  });

  it('list3DMockups: maps the digit-leading key "3d_mockups" to threeDMockups', async () => {
    const fetchImpl = mockFetchOnce(200, {
      '3d_mockup_list': {
        type: '3d_mockup_list',
        dieline_id: 'wu1evfblev8y',
        total: 7,
        page: 1,
        page_size: 100,
        '3d_mockups': [
          {
            type: '3d_mockup',
            id: 'ntgmhkhdk390',
            url: 'https://diecuttemplates.com.dev/3d/ntgmhkhdk390',
            name: 'my design',
            dieline: {
              type: 'dieline',
              id: 'wu1evfblev8y',
              dieline_template_id: 'becf-11101',
              variables: {
                unit: 'mm',
                width: 50,
                height: 150,
                length: 100,
                material: 0.5,
                overflow: false,
              },
              format: 'pdf',
              url: 'https://example.com/a.pdf',
              artwork_dimensions: { unit: 'mm', width: '287.55', height: '289.55' },
              created_at: '2024-12-26T15:21:07Z',
            },
          },
          {
            type: '3d_mockup',
            id: '1d9u48ggo9dx',
            url: 'https://diecuttemplates.com.dev/3d/1d9u48ggo9dx',
            name: 'my design',
            dieline: {
              type: 'dieline',
              id: 'wu1evfblev8y',
              dieline_template_id: 'becf-11101',
              variables: {
                unit: 'mm',
                width: 50,
                height: 150,
                length: 100,
                material: 0.5,
                overflow: false,
              },
              format: 'pdf',
              url: 'https://example.com/a.pdf',
            },
          },
        ],
        links: [
          { rel: 'self', href: '/3d-mockups/wu1evfblev8y?page=1&page_size=100', method: 'GET' },
        ],
      },
    });
    const client = makeClient(fetchImpl);

    const page = await client.list3DMockups('wu1evfblev8y', { page: 1, pageSize: 100 });

    expect(page.total).toBe(7);
    expect(page.dielineId).toBe('wu1evfblev8y');
    expect(page.threeDMockups).toHaveLength(2);
    expect(page.threeDMockups[0].id).toBe('ntgmhkhdk390');
    expect(page.threeDMockups[1].id).toBe('1d9u48ggo9dx');
  });

  it('delete3DMockup: sends DELETE and does not try to parse the body (204)', async () => {
    const fetchImpl = mockFetchOnce(204, undefined);
    const client = makeClient(fetchImpl);

    const result = await client.delete3DMockup('di_fwe4iu3vngty', 'cq8fwgnjvt9s');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://sandbox.api.diecuttemplates.com/dielines/di_fwe4iu3vngty/3d-mockups/cq8fwgnjvt9s',
    );
    expect(init.method).toBe('DELETE');
    expect(result).toBeUndefined();
  });

  it('listNestingTemplates: maps nesting_template_list and its variables/components', async () => {
    const fetchImpl = mockFetchOnce(200, {
      nesting_template_list: {
        type: 'nesting_template_list',
        id: 'ntl_kw4Z80qKP6',
        dieline_id: 'di_aretrmecuekx',
        dieline_template_id: 'becf-30203',
        total: 1,
        nesting_template_components: [],
        nesting_templates: [
          {
            type: 'nesting_template',
            id: 'lt_NJYkRajK70',
            nesting_template_components: [
              {
                type: 'nesting_template_component',
                id: 'hard-cardboard-of-the-box',
                name: 'Hard cardboard of the box',
                category: 'hard_cardboard',
              },
            ],
            variables: [
              {
                type: 'dieline_template_variable',
                name: 'sheet_width',
                description: 'Width of the sheet',
                data_type: 'length',
                required: true,
                children: [],
              },
              {
                type: 'dieline_template_variable',
                name: 'margin_x',
                description: 'Horizontal spacing',
                data_type: 'length',
                required: false,
                default_value: { value: '0.0', unit: 'mm' },
                children: [],
              },
            ],
            images: [{ type: 'svg', url: null }],
            links: [
              {
                rel: 'create_nesting',
                href: '/dielines/di_aretrmecuekx/nestings/lt_NJYkRajK70',
                method: 'POST',
              },
            ],
          },
        ],
      },
    });
    const client = makeClient(fetchImpl);

    const result = await client.listNestingTemplates('di_aretrmecuekx');

    expect(result.id).toBe('ntl_kw4Z80qKP6');
    expect(result.nestingTemplates).toHaveLength(1);
    const template = result.nestingTemplates[0];
    expect(template.nestingTemplateComponents[0].name).toBe('Hard cardboard of the box');
    expect(template.images[0]).toEqual({ type: 'svg', url: null });
    // margin_x's default_value comes as the string "0.0" in the spec; it must be normalized to number 0
    const marginX = template.variables.find((v) => v.name === 'margin_x');
    expect(marginX?.defaultValue).toEqual({ value: 0, unit: 'mm' });
    expect(typeof marginX?.defaultValue?.value).toBe('number');
  });

  it('calculateNestingEfficiencies: maps the "efficiencies" map including a null value', async () => {
    const fetchImpl = mockFetchOnce(200, {
      nesting_template_efficiencies: {
        type: 'nesting_template_efficiencies',
        dieline_id: 'di_fwe4iu3vngty',
        dieline_template_id: 'becf-30203',
        variables: { unit: 'mm', sheet_width: 1000.0, sheet_height: 700.0 },
        efficiencies: {
          lt_NJYkRajK70: { num_x: 9, num_y: 8, efficiency: { value: 72.0, type: 'percentage' } },
          lt_2lY22jOYP6: { num_x: 7, num_y: 6, efficiency: { value: 58.5, type: 'percentage' } },
          lg_xyz789abc: null,
        },
        nesting_templates: [],
        nesting_template_components: [],
      },
    });
    const client = makeClient(fetchImpl);

    const result = await client.calculateNestingEfficiencies('di_fwe4iu3vngty', {
      variables: {
        unit: 'mm',
        sheetWidth: 1000,
        sheetHeight: 700,
        sheetMarginTop: 15,
        sheetMarginBottom: 20,
        sheetMarginSide: 10,
      },
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      variables: {
        unit: 'mm',
        sheet_width: 1000,
        sheet_height: 700,
        sheet_margin_top: 15,
        sheet_margin_bottom: 20,
        sheet_margin_side: 10,
      },
    });

    expect(result.efficiencies['lt_NJYkRajK70']).toEqual({
      numX: 9,
      numY: 8,
      efficiency: { value: 72, type: 'percentage' },
    });
    expect(result.efficiencies['lg_xyz789abc']).toBeNull();
  });

  it('createNesting: serializes variables (including num_x/num_y and dynamic variables) and maps the response', async () => {
    const fetchImpl = mockFetchOnce(200, {
      nesting: {
        type: 'nesting',
        id: 'ne_wpxjk9m2nlrw',
        dieline_id: 'di_ueipnpyp0rlw',
        dieline_template_id: 'becf-10301',
        nesting_template_id: 'lt_xyz123abc',
        variables: {
          unit: 'mm',
          sheet_width: 1000.0,
          sheet_height: 700.0,
          sheet_margin_top: 15.0,
          sheet_margin_bottom: 20.0,
          sheet_margin_side: 10.0,
          dimension_texts: true,
          dieline_variables: { unit: 'mm', width: 100, height: 150, length: 50, material: '0.8' },
          num_x: 3,
          num_y: 2,
          margin_x: 10,
          margin_y: 20,
        },
        format: 'pdf',
        width: { value: 990.0, unit: 'mm' },
        height: { value: 880.0, unit: 'mm' },
        nesting_overflow: false,
        sum_of_line_lengths: [
          { name: 'Cut', unit: 'mm', value: 3000.0 },
          { name: 'Crease', unit: 'mm', value: 5000.0 },
          { name: 'Total', unit: 'mm', value: 8000.0 },
        ],
        url: 'https://d2atdwxjx7uc4i.cloudfront.net/nestings/abc123.pdf',
        created_at: '2024-12-18T19:27:22Z',
      },
    });
    const client = makeClient(fetchImpl);

    const nesting = await client.createNesting('di_ueipnpyp0rlw', 'lt_xyz123abc', {
      format: 'pdf',
      variables: {
        unit: 'mm',
        sheetWidth: 1000,
        sheetHeight: 700,
        sheetMarginTop: 15,
        sheetMarginBottom: 20,
        sheetMarginSide: 10,
        numX: 3,
        numY: 2,
      },
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://sandbox.api.diecuttemplates.com/dielines/di_ueipnpyp0rlw/nestings/lt_xyz123abc',
    );
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.variables.num_x).toBe(3);
    expect(sentBody.variables.sheet_width).toBe(1000);

    expect(nesting.id).toBe('ne_wpxjk9m2nlrw');
    expect(nesting.nestingOverflow).toBe(false);
    // dieline_variables.material comes as the string "0.8" in this spec example -> it must be normalized to number
    expect(nesting.variables.dielineVariables?.material).toBe(0.8);
    expect(typeof nesting.variables.dielineVariables?.material).toBe('number');
    expect(nesting.sumOfLineLengths).toHaveLength(3);
    expect(nesting.width).toEqual({ value: 990, unit: 'mm' });
  });
});
