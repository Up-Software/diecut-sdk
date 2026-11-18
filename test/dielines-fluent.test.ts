import { describe, it, expect } from 'vitest';
import { DielinesClient } from '../src/dielines/client';
import { mockFetchOnce, mockFetchSequence } from './helpers';

/**
 * Tests for the fluent, immutable interface: the resources returned by DielinesClient (Dieline,
 * ThreeDMockup, NestingTemplate) expose convenience methods based on their HATEOAS `links`,
 * which reuse the resource id without the user having to repeat it, and the returned object is
 * frozen (Object.freeze) so it is immutable.
 */

const API_KEY = 'test-dielines-key';

function makeClient(fetchImpl: typeof fetch) {
  return new DielinesClient({
    apiKey: API_KEY,
    environment: 'sandbox',
    fetchImpl,
    minRequestIntervalMs: 0,
  });
}

const DIELINE_RESPONSE = {
  dieline: {
    type: 'dieline',
    id: 'di_ueipnpyp0rlw',
    dieline_template_id: 'becf-10301',
    variables: { unit: 'mm', length: 250, width: 200, height: 200, material: 0.389 },
    format: 'pdf',
    url: 'https://example.com/dieline.pdf',
    links: [
      { rel: 'create_3d_mockup', href: '/dielines/di_ueipnpyp0rlw/3d-mockups', method: 'POST' },
      {
        rel: 'list_nesting_templates',
        href: '/dielines/di_ueipnpyp0rlw/nesting-templates',
        method: 'GET',
      },
      {
        rel: 'calculate_nesting_efficiencies',
        href: '/dielines/di_ueipnpyp0rlw/nesting-template-efficiencies',
        method: 'POST',
      },
    ],
    created_at: '2024-12-18T19:27:22Z',
  },
};

const MOCKUP_RESPONSE = {
  '3d_mockup': {
    type: '3d_mockup',
    id: 'llnmb1oh8r',
    url: 'https://www.diecuttemplates.com/3d/llnmb1oh8r',
    name: 'My design',
    dieline: DIELINE_RESPONSE.dieline,
    links: [
      { rel: 'update', href: '/dielines/di_ueipnpyp0rlw/3d-mockups/llnmb1oh8r', method: 'PUT' },
      { rel: 'delete', href: '/dielines/di_ueipnpyp0rlw/3d-mockups/llnmb1oh8r', method: 'DELETE' },
    ],
  },
};

const NESTING_TEMPLATES_RESPONSE = {
  nesting_template_list: {
    type: 'nesting_template_list',
    id: 'ntl_kw4Z80qKP6',
    dieline_id: 'di_ueipnpyp0rlw',
    dieline_template_id: 'becf-10301',
    total: 1,
    nesting_template_components: [],
    nesting_templates: [
      {
        type: 'nesting_template',
        id: 'lt_NJYkRajK70',
        nesting_template_components: [],
        variables: [],
        images: [],
        links: [
          {
            rel: 'create_nesting',
            href: '/dielines/di_ueipnpyp0rlw/nestings/lt_NJYkRajK70',
            method: 'POST',
          },
        ],
      },
    ],
  },
};

const NESTING_RESPONSE = {
  nesting: {
    type: 'nesting',
    id: 'ne_wpxjk9m2nlrw',
    dieline_id: 'di_ueipnpyp0rlw',
    dieline_template_id: 'becf-10301',
    nesting_template_id: 'lt_NJYkRajK70',
    variables: { unit: 'mm', sheet_width: 1000, sheet_height: 700 },
    format: 'pdf',
    width: { value: 990, unit: 'mm' },
    height: { value: 880, unit: 'mm' },
    nesting_overflow: false,
    sum_of_line_lengths: [],
    url: 'https://example.com/nesting.pdf',
    created_at: '2024-12-18T19:27:22Z',
  },
};

describe('Fluent interface based on HATEOAS links', () => {
  it('dieline.create3DMockup() reuses the dieline id without passing it by hand', async () => {
    const fetchImpl = mockFetchSequence([
      { status: 200, body: DIELINE_RESPONSE },
      { status: 200, body: MOCKUP_RESPONSE },
    ]);
    const client = makeClient(fetchImpl);

    const dieline = await client.createDieline('becf-10301', {
      format: 'pdf',
      variables: { unit: 'mm', length: 250, width: 200, height: 200 },
    });
    const mockup = await dieline.create3DMockup({ file: Buffer.from('fake'), fileName: 'a.png' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe('https://sandbox.api.diecuttemplates.com/dielines/di_ueipnpyp0rlw/3d-mockups');
    expect(init.method).toBe('POST');
    expect(mockup.id).toBe('llnmb1oh8r');
  });

  it('dieline.listNestingTemplates() and dieline.calculateNestingEfficiencies() reuse the dieline id', async () => {
    const fetchImpl = mockFetchSequence([
      { status: 200, body: DIELINE_RESPONSE },
      { status: 200, body: NESTING_TEMPLATES_RESPONSE },
    ]);
    const client = makeClient(fetchImpl);
    const dieline = await client.createDieline('becf-10301', {
      format: 'pdf',
      variables: { unit: 'mm', length: 250, width: 200, height: 200 },
    });

    const result = await dieline.listNestingTemplates();

    const [url] = fetchImpl.mock.calls[1];
    expect(url).toBe(
      'https://sandbox.api.diecuttemplates.com/dielines/di_ueipnpyp0rlw/nesting-templates',
    );
    expect(result.nestingTemplates).toHaveLength(1);
  });

  it('mockup.update() and mockup.delete() reuse dielineId + mockupId', async () => {
    const fetchImpl = mockFetchSequence([
      { status: 200, body: MOCKUP_RESPONSE },
      { status: 200, body: MOCKUP_RESPONSE },
      { status: 204, body: undefined },
    ]);
    const client = makeClient(fetchImpl);
    const mockup = await client.create3DMockup('di_ueipnpyp0rlw', { file: Buffer.from('fake') });

    await mockup.update({ name: 'nuevo nombre' });
    const [updateUrl, updateInit] = fetchImpl.mock.calls[1];
    expect(updateUrl).toBe(
      'https://sandbox.api.diecuttemplates.com/dielines/di_ueipnpyp0rlw/3d-mockups/llnmb1oh8r',
    );
    expect(updateInit.method).toBe('PUT');

    await mockup.delete();
    const [deleteUrl, deleteInit] = fetchImpl.mock.calls[2];
    expect(deleteUrl).toBe(
      'https://sandbox.api.diecuttemplates.com/dielines/di_ueipnpyp0rlw/3d-mockups/llnmb1oh8r',
    );
    expect(deleteInit.method).toBe('DELETE');
  });

  it('nestingTemplate.createNesting() reuses dielineId + nestingTemplateId', async () => {
    const fetchImpl = mockFetchSequence([
      { status: 200, body: NESTING_TEMPLATES_RESPONSE },
      { status: 200, body: NESTING_RESPONSE },
    ]);
    const client = makeClient(fetchImpl);
    const result = await client.listNestingTemplates('di_ueipnpyp0rlw');
    const template = result.nestingTemplates[0];

    const nesting = await template.createNesting({
      format: 'pdf',
      variables: { unit: 'mm', sheetWidth: 1000, sheetHeight: 700 },
    });

    const [url] = fetchImpl.mock.calls[1];
    expect(url).toBe(
      'https://sandbox.api.diecuttemplates.com/dielines/di_ueipnpyp0rlw/nestings/lt_NJYkRajK70',
    );
    expect(nesting.id).toBe('ne_wpxjk9m2nlrw');
  });

  it('returned resources are frozen (Object.freeze): mutating them throws TypeError', async () => {
    const fetchImpl = mockFetchOnce(200, DIELINE_RESPONSE);
    const client = makeClient(fetchImpl);

    const dieline = await client.createDieline('becf-10301', {
      format: 'pdf',
      variables: { unit: 'mm' },
    });

    expect(Object.isFrozen(dieline)).toBe(true);
    expect(() => {
      (dieline as any).id = 'otro-id';
    }).toThrow(TypeError);
  });
});
