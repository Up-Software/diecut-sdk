import { describe, it, expect } from 'vitest';
import { DielinesClient } from '../src/dielines/client';
import { mockFetchOnce, mockFetchSequence } from './helpers';

function makeClient(fetchImpl: typeof fetch) {
  return new DielinesClient({
    apiKey: 'k',
    environment: 'sandbox',
    fetchImpl,
    minRequestIntervalMs: 0,
  });
}

function summary(id: string) {
  return {
    type: 'dieline_template_summary',
    id,
    group_id: 'cartons_tuck_end_boxes',
    standard_codes: [{ type: 'ecma', value: 'A20.20.03.01', approximate: true }],
    images: [
      { type: 'png_small', url: 'https://example.com/s.png' },
      { type: 'svg', url: 'https://example.com/p.svg' },
    ],
    links: [
      { rel: 'dieline_template', href: `/dieline-templates/mm/${id}`, method: 'GET', name: 'mm' },
      { rel: 'web', href: `https://www.diecuttemplates.com/${id}`, method: 'GET' },
    ],
  };
}

function listBody(items: unknown[], page: number, total: number, next = false) {
  return {
    dieline_template_list: {
      type: 'dieline_template_list',
      total,
      page,
      page_size: 2,
      dieline_templates: items,
      links: [
        { rel: 'self', href: '/dieline-templates', method: 'GET' },
        ...(next
          ? [{ rel: 'next_page', href: '/dieline-templates?page=' + (page + 1), method: 'GET' }]
          : []),
      ],
    },
  };
}

describe('DielinesClient.listTemplates', () => {
  it('builds the query and maps the summaries', async () => {
    const fetchImpl = mockFetchOnce(200, listBody([summary('becf-1')], 1, 1));
    const page = await makeClient(fetchImpl).listTemplates({
      groupId: 'cartons_tuck_end_boxes',
      page: 2,
      pageSize: 50,
    });

    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe('/dieline-templates');
    expect(url.searchParams.get('group_id')).toBe('cartons_tuck_end_boxes');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('page_size')).toBe('50');
    expect(url.searchParams.has('expand')).toBe(false);
    expect(page.total).toBe(1);
    expect(page.hasNextPage).toBe(false);
    expect(page.dielineTemplates[0]).toEqual({
      type: 'dieline_template_summary',
      id: 'becf-1',
      groupId: 'cartons_tuck_end_boxes',
      standardCodes: [{ type: 'ecma', value: 'A20.20.03.01', approximate: true }],
      images: [
        { type: 'png_small', url: 'https://example.com/s.png' },
        { type: 'svg', url: 'https://example.com/p.svg' },
      ],
      links: [
        {
          rel: 'dieline_template',
          href: '/dieline-templates/mm/becf-1',
          method: 'GET',
          name: 'mm',
        },
        {
          rel: 'web',
          href: 'https://www.diecuttemplates.com/becf-1',
          method: 'GET',
          name: undefined,
        },
      ],
    });
  });

  it('without standard_codes leaves standardCodes undefined and without params sends no query', async () => {
    const { standard_codes: _standardCodes, ...sinCodigos } = summary('becf-2');
    const fetchImpl = mockFetchOnce(200, listBody([sinCodigos], 1, 1));
    const page = await makeClient(fetchImpl).listTemplates();
    expect(new URL(fetchImpl.mock.calls[0][0]).search).toBe('');
    expect(page.dielineTemplates[0].standardCodes).toBeUndefined();
  });

  it('expand=true sends expand and unit, and maps full templates', async () => {
    const full = {
      type: 'dieline_template',
      id: 'becf-10301',
      group: { type: 'dieline_template_group', id: 'g', name: 'G', category: 'Cartons' },
      tags: [],
      variables: [],
      links: [],
      images: [],
    };
    const fetchImpl = mockFetchOnce(200, listBody([full], 1, 1));
    const page = await makeClient(fetchImpl).listTemplates({ expand: true, unit: 'in' });

    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.get('expand')).toBe('true');
    expect(url.searchParams.get('unit')).toBe('in');
    expect(page.dielineTemplates[0].type).toBe('dieline_template');
    expect(page.dielineTemplates[0].group.id).toBe('g');
  });

  it('validates pageSize, page and unit before requesting', async () => {
    const fetchImpl = mockFetchOnce(200, listBody([], 1, 0));
    const client = makeClient(fetchImpl);
    await expect(client.listTemplates({ pageSize: 0 })).rejects.toThrow(/pageSize/);
    await expect(client.listTemplates({ pageSize: 101 })).rejects.toThrow(/pageSize/);
    await expect(client.listTemplates({ page: 0 })).rejects.toThrow(/page/);
    await expect(client.listTemplates({ expand: true } as any)).rejects.toThrow(/unit/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('iterateTemplates walks several pages following next_page and uses pageSize 100', async () => {
    const fetchImpl = mockFetchSequence([
      { status: 200, body: listBody([summary('a'), summary('b')], 1, 3, true) },
      { status: 200, body: listBody([summary('c')], 2, 3, false) },
    ]);
    const ids: string[] = [];
    for await (const t of makeClient(fetchImpl).iterateTemplates({ groupId: 'g' })) ids.push(t.id);

    expect(ids).toEqual(['a', 'b', 'c']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = new URL(fetchImpl.mock.calls[0][0]);
    const second = new URL(fetchImpl.mock.calls[1][0]);
    expect(first.searchParams.get('page')).toBe('1');
    expect(first.searchParams.get('page_size')).toBe('100');
    expect(second.searchParams.get('page')).toBe('2');
  });

  it('listAllTemplates without links uses total to decide whether there are more pages', async () => {
    const sinLinks = (items: unknown[], page: number) => ({
      dieline_template_list: { total: 3, page, page_size: 2, dieline_templates: items },
    });
    const fetchImpl = mockFetchSequence([
      { status: 200, body: sinLinks([summary('a'), summary('b')], 1) },
      { status: 200, body: sinLinks([summary('c')], 2) },
    ]);
    const all = await makeClient(fetchImpl).listAllTemplates({ groupId: 'g', pageSize: 2 });
    expect(all.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
