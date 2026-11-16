import { describe, it, expect } from 'vitest';
import { DielinesClient } from '../src/dielines/client';
import { mockFetchOnce } from './helpers';

function makeClient(fetchImpl: typeof fetch) {
  return new DielinesClient({ apiKey: 'k', environment: 'sandbox', fetchImpl });
}

const minimalDieline = {
  type: 'dieline',
  id: 'di_1',
  dieline_template_id: 'becf-10301',
  variables: { unit: 'mm' },
  format: 'pdf',
  url: 'https://example.com/d.pdf',
};

describe('API completeness against the documentation', () => {
  it('createDieline sends dimension_texts inside variables, not at the top level', async () => {
    const fetchImpl = mockFetchOnce(200, { dieline: minimalDieline });
    await makeClient(fetchImpl).createDieline('becf-10301', {
      format: 'svg',
      dimensionTexts: false,
      variables: { unit: 'mm', length: 10 },
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.dimension_texts).toBeUndefined();
    expect(body.variables).toEqual({ unit: 'mm', length: 10, dimension_texts: false });
  });

  it('createDieline leaves variables untouched when dimensionTexts is not set', async () => {
    const fetchImpl = mockFetchOnce(200, { dieline: minimalDieline });
    await makeClient(fetchImpl).createDieline('becf-10301', {
      format: 'svg',
      variables: { unit: 'mm' },
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.variables).toEqual({ unit: 'mm' });
  });

  it('createNesting sends dimension_texts inside variables, not at the top level', async () => {
    const fetchImpl = mockFetchOnce(200, { nesting: { type: 'nesting', id: 'ne_1' } });
    await makeClient(fetchImpl).createNesting('di_1', 'lt_1', {
      format: 'pdf',
      dimensionTexts: false,
      variables: { unit: 'mm', sheetWidth: 1000, sheetHeight: 700 },
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.dimension_texts).toBeUndefined();
    expect(body.variables.dimension_texts).toBe(false);
    expect(body.variables.sheet_width).toBe(1000);
  });

  it('create3DMockup sends part_substrates as bracketed multipart fields', async () => {
    const fetchImpl = mockFetchOnce(200, {
      '3d_mockup': { type: '3d_mockup', id: 'm1', dieline: minimalDieline },
    });
    await makeClient(fetchImpl).create3DMockup('di_1', {
      file: Buffer.from('x'),
      fileName: 'art.png',
      contentType: 'image/png',
      partSubstrates: { '1': 'corrugated_brown', '2': '' },
    });
    const form = fetchImpl.mock.calls[0][1].body as FormData;
    expect(form.get('part_substrates[1]')).toBe('corrugated_brown');
    expect(form.get('part_substrates[2]')).toBe('');
    expect(form.get('part_substrates')).toBeNull();
  });

  it('listDielines maps dielineTemplateId, links inside dieline_list and hasNextPage', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline_list: {
        type: 'dieline_list',
        dieline_template_id: 'becf-10301',
        total: 3,
        page: 1,
        page_size: 2,
        dielines: [minimalDieline],
        links: [
          { rel: 'self', href: '/x?page=1', method: 'GET' },
          { rel: 'next_page', href: '/x?page=2', method: 'GET' },
        ],
      },
    });
    const page = await makeClient(fetchImpl).listDielines('becf-10301');
    expect(page.dielineTemplateId).toBe('becf-10301');
    expect(page.links.map((l) => l.rel)).toEqual(['self', 'next_page']);
    expect(page.hasNextPage).toBe(true);
  });

  it('listDielines computes hasNextPage from totals when there are no links', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline_list: { total: 2, page: 1, page_size: 2, dielines: [minimalDieline, minimalDieline] },
    });
    const page = await makeClient(fetchImpl).listDielines('becf-10301');
    expect(page.links).toEqual([]);
    expect(page.hasNextPage).toBe(false);
  });

  it('listDielines tolerates an empty response', async () => {
    const page = await makeClient(mockFetchOnce(200, {})).listDielines('becf-10301');
    expect(page.dielines).toEqual([]);
    expect(page.hasNextPage).toBe(false);
  });

  it('list3DMockups maps links and hasNextPage', async () => {
    const fetchImpl = mockFetchOnce(200, {
      '3d_mockup_list': {
        type: '3d_mockup_list',
        dieline_id: 'di_1',
        total: 150,
        page: 1,
        page_size: 100,
        '3d_mockups': [],
        links: [{ rel: 'next_page', href: '/dielines/di_1/3d-mockups?page=2', method: 'GET' }],
      },
    });
    const page = await makeClient(fetchImpl).list3DMockups('di_1');
    expect(page.hasNextPage).toBe(true);
    expect(page.links[0].rel).toBe('next_page');
    expect(page.threeDMockups).toEqual([]);
  });

  it('list3DMockups without links falls back to totals', async () => {
    const fetchImpl = mockFetchOnce(200, {
      '3d_mockup_list': { dieline_id: 'di_1', total: 1, page: 1, page_size: 100, '3d_mockups': [] },
    });
    const page = await makeClient(fetchImpl).list3DMockups('di_1');
    expect(page.hasNextPage).toBe(false);
  });

  it('listNestingTemplates accepts a singular image and the nesting_templates_list wrapper', async () => {
    const fetchImpl = mockFetchOnce(200, {
      nesting_templates_list: {
        id: 'ntl_1',
        dieline_id: 'di_1',
        dieline_template_id: 'becf-10301',
        total: 1,
        nesting_template_components: [],
        nesting_templates: [
          {
            type: 'nesting_template',
            id: 'lt_1',
            image: { type: 'svg', url: 'https://example.com/n.svg' },
          },
        ],
      },
    });
    const result = await makeClient(fetchImpl).listNestingTemplates('di_1');
    expect(result.dielineId).toBe('di_1');
    expect(result.nestingTemplates[0].images).toEqual([
      { type: 'svg', url: 'https://example.com/n.svg' },
    ]);
  });

  it('listNestingTemplates yields empty images when neither image nor images is present', async () => {
    const fetchImpl = mockFetchOnce(200, {
      nesting_template_list: { id: 'x', dieline_id: 'di_1', nesting_templates: [{ id: 'lt_1' }] },
    });
    const result = await makeClient(fetchImpl).listNestingTemplates('di_1');
    expect(result.nestingTemplates[0].images).toEqual([]);
    expect(result.nestingTemplates[0].variables).toEqual([]);
  });

  it('getTemplate maps standard_codes of the group', async () => {
    const fetchImpl = mockFetchOnce(200, {
      dieline_template: {
        id: 'becf-1',
        group: {
          id: 'g',
          name: 'G',
          category: 'Cartons',
          standard_codes: [
            { type: 'fefco', value: '0201', approximate: true },
            { type: 'ecma', value: 'B40' },
          ],
        },
      },
    });
    const template = await makeClient(fetchImpl).getTemplate('becf-1', 'mm');
    expect(template.group.standardCodes).toEqual([
      { type: 'fefco', value: '0201', approximate: true },
      { type: 'ecma', value: 'B40', approximate: false },
    ]);
  });
});
