import { describe, it, expect, vi } from 'vitest';
import { ApiHttpClient } from '../src/http-client';
import { DielinesClient } from '../src/dielines/client';
import { DimensionsClient } from '../src/dimensions/client';
import { DiecutApiError, DiecutNotFoundError, mapErrorResponse } from '../src/errors';
import { mockFetchOnce, mockFetchSequence } from './helpers';

function makeHttp(fetchImpl: typeof fetch, timeoutMs = 20) {
  return new ApiHttpClient({
    baseUrl: 'https://api.example.com/',
    apiKey: 'k',
    apiVersionHeader: 'Dielines-Api-Version',
    timeoutMs,
    fetchImpl,
  });
}

describe('ApiHttpClient edge cases', () => {
  it('turns an aborted request into a timeout error that names the method and URL', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }) as unknown as typeof fetch;

    await expect(makeHttp(fetchImpl).request({ method: 'GET', path: '/slow' })).rejects.toThrow(
      /exceeded the timeout of 20ms: GET https:\/\/api\.example\.com\/slow/,
    );
  });

  it('rethrows network errors that are not timeouts unchanged', async () => {
    const failure = new TypeError('fetch failed');
    const fetchImpl = vi.fn().mockRejectedValue(failure);
    await expect(
      makeHttp(fetchImpl as unknown as typeof fetch).request({ method: 'GET', path: '/x' }),
    ).rejects.toBe(failure);
  });

  it('normalizes a path without a leading slash and strips trailing slashes from the base URL', async () => {
    const fetchImpl = mockFetchOnce(200, { ok: true });
    await makeHttp(fetchImpl).request({
      method: 'GET',
      path: 'ping',
      query: { page: 0, flag: false },
    });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/ping?page=0&flag=false');
  });

  it('returns undefined for a 204 even without expectNoContent', async () => {
    const result = await makeHttp(mockFetchOnce(204, undefined)).request({
      method: 'DELETE',
      path: '/x',
    });
    expect(result).toBeUndefined();
  });

  it('exposes the x-request-id header on errors', async () => {
    const fetchImpl = mockFetchOnce(
      404,
      { message: 'nope' },
      { headers: { 'x-request-id': 'req-1' } },
    );
    try {
      await makeHttp(fetchImpl).request({ method: 'GET', path: '/x' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DiecutNotFoundError);
      expect((error as DiecutApiError).requestId).toBe('req-1');
    }
  });
});

describe('error mapping', () => {
  it('maps other statuses to the base DiecutApiError', () => {
    for (const status of [402, 500, 503]) {
      const error = mapErrorResponse(status, { message: `status ${status}` });
      expect(error).toBeInstanceOf(DiecutApiError);
      expect(error.constructor).toBe(DiecutApiError);
      expect(error.status).toBe(status);
      expect(error.message).toBe(`status ${status}`);
    }
  });

  it('uses a default message when the body has no usable message', () => {
    expect(mapErrorResponse(500, { message: '' }).message).toMatch(/without a message/);
    expect(mapErrorResponse(500, null).message).toMatch(/without a message/);
    expect(mapErrorResponse(500, 'text').message).toMatch(/without a message/);
  });

  it('validation errors carry change_value and swap_values suggestions and tolerate a missing errors array', () => {
    const withErrors = mapErrorResponse(400, {
      message: 'Validation failed',
      errors: [
        {
          message: 'too small',
          suggestion: { type: 'change_value', name: 'top_tuck_flap', value: 0.355 },
        },
        { message: 'order', suggestion: { type: 'swap_values', names: ['a', 'b'] } },
      ],
    });
    expect('errors' in withErrors && (withErrors as any).errors).toHaveLength(2);
    expect((withErrors as any).errors[0].suggestion).toEqual({
      type: 'change_value',
      name: 'top_tuck_flap',
      value: 0.355,
    });
    expect((withErrors as any).errors[1].suggestion.names).toEqual(['a', 'b']);

    expect((mapErrorResponse(400, { message: 'bad' }) as any).errors).toEqual([]);
    expect((mapErrorResponse(400, null) as any).errors).toEqual([]);
  });
});

describe('DielinesClient edge cases', () => {
  it('uses an explicit baseUrl over the environment and URL-encodes path segments', async () => {
    const fetchImpl = mockFetchOnce(200, { dieline_template: { id: 'a/b' } });
    const client = new DielinesClient({
      apiKey: 'k',
      baseUrl: 'https://proxy.example.com',
      environment: 'sandbox',
      fetchImpl,
    });
    await client.getTemplate('a/b', 'in');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://proxy.example.com/dieline-templates/in/a%2Fb');
  });

  it('defaults to the production base URL', async () => {
    const fetchImpl = mockFetchOnce(200, { dieline_template_group_list: {} });
    expect(await new DielinesClient({ apiKey: 'k', fetchImpl }).listTemplateGroups()).toEqual([]);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.diecuttemplates.com/dieline-template-groups',
    );
  });

  it('delete3DMockup resolves to undefined on 204', async () => {
    const fetchImpl = mockFetchOnce(204, undefined);
    const result = await new DielinesClient({ apiKey: 'k', fetchImpl }).delete3DMockup(
      'di_1',
      'm1',
    );
    expect(result).toBeUndefined();
    expect(fetchImpl.mock.calls[0][1].method).toBe('DELETE');
  });

  it('create3DMockup accepts a Blob and sends every optional field', async () => {
    const fetchImpl = mockFetchOnce(200, { '3d_mockup': { id: 'm1' } });
    const client = new DielinesClient({ apiKey: 'k', fetchImpl });
    await client.create3DMockup('di_1', {
      file: new Blob(['x'], { type: 'image/png' }),
      name: 'Mockup',
      outsideDesign: false,
      sceneBackgroundColor: '#707070',
      substrate: 'kraft_brown',
    });
    const form = fetchImpl.mock.calls[0][1].body as FormData;
    expect(form.get('name')).toBe('Mockup');
    expect(form.get('outside_design')).toBe('false');
    expect(form.get('scene_background_color')).toBe('#707070');
    expect(form.get('substrate')).toBe('kraft_brown');
    expect((form.get('file') as File).name).toBe('artwork');
  });

  it('mappers tolerate missing optional fields in a dieline', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline: { id: 'di_1', variables: { unit: 'weird', material: 'abc' } },
    });
    const dieline = await new DielinesClient({ apiKey: 'k', fetchImpl }).createDieline('t', {
      format: 'pdf',
      variables: { unit: 'mm' },
    });
    expect(dieline.variables.unit).toBe('mm');
    expect(dieline.variables.material).toBeUndefined();
    expect(dieline.artworkDimensions).toBeUndefined();
    expect(dieline.area).toBeUndefined();
    expect(dieline.links).toEqual([]);
  });

  it('calculateNestingEfficiencies maps null efficiencies and serializes sheet variables', async () => {
    const fetchImpl = mockFetchOnce(200, {
      nesting_template_efficiencies: {
        dieline_id: 'di_1',
        dieline_template_id: 'becf-1',
        efficiencies: {
          lt_1: { num_x: 2, num_y: 3, efficiency: { value: '71.5', type: 'percentage' } },
          lt_2: null,
        },
      },
    });
    const result = await new DielinesClient({
      apiKey: 'k',
      fetchImpl,
    }).calculateNestingEfficiencies('di_1', {
      variables: { unit: 'in', sheetWidth: 40, sheetHeight: 28, sheetMarginSide: 1 },
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.variables).toEqual({
      unit: 'in',
      sheet_width: 40,
      sheet_height: 28,
      sheet_margin_side: 1,
    });
    expect(result.efficiencies.lt_1?.efficiency.value).toBe(71.5);
    expect(result.efficiencies.lt_2).toBeNull();
    expect(result.nestingTemplates).toEqual([]);
    expect(result.nestingTemplateComponents).toEqual([]);
  });

  it('createNesting maps a sparse response without throwing', async () => {
    const fetchImpl = mockFetchOnce(200, { nesting: { id: 'ne_1', nesting_overflow: true } });
    const nesting = await new DielinesClient({ apiKey: 'k', fetchImpl }).createNesting(
      'di_1',
      'lt_1',
      {
        format: 'svg',
        variables: { unit: 'mm', sheetWidth: 1, sheetHeight: 1, margin_x: 5 },
      },
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string).variables.margin_x).toBe(5);
    expect(nesting.nestingOverflow).toBe(true);
    expect(nesting.sumOfLineLengths).toEqual([]);
    expect(nesting.variables.unit).toBe('mm');
    expect(nesting.variables.dielineVariables).toBeUndefined();
  });
});

describe('listTemplates / iteration edge cases', () => {
  it('iterateTemplates stops when a page is empty even if it reports a next page', async () => {
    const fetchImpl = mockFetchSequence([
      {
        status: 200,
        body: {
          dieline_template_list: {
            total: 5,
            page: 1,
            page_size: 100,
            dieline_templates: [],
            links: [{ rel: 'next_page' }],
          },
        },
      },
    ]);
    const all = await new DielinesClient({ apiKey: 'k', fetchImpl }).listAllTemplates();
    expect(all).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('listTemplates without any params sends no query string', async () => {
    const fetchImpl = mockFetchOnce(200, { dieline_template_list: {} });
    const page = await new DielinesClient({ apiKey: 'k', fetchImpl }).listTemplates();
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.diecuttemplates.com/dieline-templates');
    expect(page.dielineTemplates).toEqual([]);
    expect(page.hasNextPage).toBe(false);
  });

  it('listTemplates with expand maps full templates and standard codes of summaries', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline_template_list: {
        total: 1,
        page: 1,
        page_size: 25,
        dieline_templates: [
          { id: 'becf-1', group: { id: 'g' }, tags: ['postal_lock'], variables: [] },
        ],
      },
    });
    const page = await new DielinesClient({ apiKey: 'k', fetchImpl }).listTemplates({
      expand: true,
      unit: 'mm',
    });
    expect(fetchImpl.mock.calls[0][0]).toContain('expand=true');
    expect(page.dielineTemplates[0].type).toBe('dieline_template');
    expect(page.dielineTemplates[0].tags).toEqual(['postal_lock']);
  });
});

describe('DimensionsClient edge cases', () => {
  it('calculateParts maps a sparse part list and area values given as strings', async () => {
    const fetchImpl = mockFetchOnce(200, {
      part_list: {
        id: 'pl_1',
        dieline_template_id: 'becf-11101',
        total: '2',
        parts: [
          {
            id: 'default',
            name: 'default',
            category: 'carton',
            bounding_box: { unit: 'mm', width: '210.5', height: 148 },
          },
          { id: 'cover', area: { value: '27412.6', unit: 'mm2' } },
        ],
      },
    });
    const result = await new DimensionsClient({ apiKey: 'dim_k', fetchImpl }).calculateParts(
      'becf-11101',
      {
        area: true,
        variables: { unit: 'mm' },
      },
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string).area).toBe(true);
    expect(result.total).toBe(2);
    expect(result.parts[0].boundingBox).toEqual({ unit: 'mm', width: 210.5, height: 148 });
    expect(result.parts[0].area).toBeUndefined();
    expect(result.parts[1].area).toEqual({ value: 27412.6, unit: 'mm2' });
    expect(Number.isNaN(result.parts[1].boundingBox.width)).toBe(true);
  });

  it('calculateParts tolerates an empty response', async () => {
    const result = await new DimensionsClient({
      apiKey: 'dim_k',
      fetchImpl: mockFetchOnce(200, {}),
    }).calculateParts('t', {
      variables: { unit: 'mm' },
    });
    expect(result.parts).toEqual([]);
    expect(result.total).toBeNaN();
  });

  it('uses the sandbox base URL when requested', async () => {
    const fetchImpl = mockFetchOnce(200, { dieline_template_group_list: {} });
    await new DimensionsClient({
      apiKey: 'dim_k',
      environment: 'sandbox',
      fetchImpl,
    }).listTemplateGroups();
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://sandbox.api.diecuttemplates.com/dimensions/template-groups',
    );
  });
});
