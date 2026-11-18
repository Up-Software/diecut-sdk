import { describe, it, expect } from 'vitest';
import { ApiHttpClient } from '../src/http-client';
import {
  DiecutValidationError,
  DiecutAuthError,
  DiecutNotFoundError,
  DiecutApiError,
} from '../src/errors';
import { mockFetchOnce } from './helpers';

const BASE_URL = 'https://api.diecuttemplates.com';

describe('ApiHttpClient', () => {
  it('builds the URL with query params (omitting undefined), method and headers for a JSON body', async () => {
    const fetchImpl = mockFetchOnce(200, { ok: true });
    const client = new ApiHttpClient({
      baseUrl: BASE_URL,
      apiKey: 'key123',
      apiVersionHeader: 'Dielines-Api-Version',
      fetchImpl,
    });

    await client.request({
      method: 'POST',
      path: '/dieline-templates/becf-10301/dielines',
      query: { page: 2, page_size: undefined },
      json: { format: 'pdf' },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/dieline-templates/becf-10301/dielines?page=2`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer key123');
    expect(init.headers['Dielines-Api-Version']).toBe('1.0');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ format: 'pdf' }));
  });

  it('uses the configured version header and apiVersion', async () => {
    const fetchImpl = mockFetchOnce(200, {});
    const client = new ApiHttpClient({
      baseUrl: BASE_URL,
      apiKey: 'dim_abc',
      apiVersionHeader: 'Dimensions-Api-Version',
      apiVersion: '1.0',
      fetchImpl,
    });
    await client.request({ method: 'GET', path: '/dimensions/template-groups' });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['Dimensions-Api-Version']).toBe('1.0');
    expect(init.headers.Authorization).toBe('Bearer dim_abc');
  });

  it('does not set Content-Type manually when the body is FormData', async () => {
    const fetchImpl = mockFetchOnce(200, { ok: true });
    const client = new ApiHttpClient({
      baseUrl: BASE_URL,
      apiKey: 'key123',
      apiVersionHeader: 'Dielines-Api-Version',
      fetchImpl,
    });
    const form = new FormData();
    form.append('file', new Blob(['hola']), 'a.png');

    await client.request({ method: 'POST', path: '/dielines/di_1/3d-mockups', form });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBe(form);
  });

  it('does not try to parse the body as JSON when expectNoContent is true', async () => {
    const fetchImpl = mockFetchOnce(204, undefined);
    const client = new ApiHttpClient({
      baseUrl: BASE_URL,
      apiKey: 'key123',
      apiVersionHeader: 'Dielines-Api-Version',
      fetchImpl,
    });

    const result = await client.request({
      method: 'DELETE',
      path: '/dielines/di_1/3d-mockups/m1',
      expectNoContent: true,
    });

    expect(result).toBeUndefined();
  });

  it('throws DiecutValidationError on 400 shaped like {message, errors[]}', async () => {
    const fetchImpl = mockFetchOnce(400, {
      message: 'Validation failed for one or more variables.',
      errors: [{ message: "Invalid 'unit'." }],
    });
    const client = new ApiHttpClient({
      baseUrl: BASE_URL,
      apiKey: 'key123',
      apiVersionHeader: 'Dielines-Api-Version',
      fetchImpl,
    });

    const promise = client.request({ method: 'POST', path: '/x', json: {} });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiecutValidationError);
    const validationError = error as DiecutValidationError;
    expect(validationError.status).toBe(400);
    expect(validationError.errors).toHaveLength(1);
    expect(validationError.errors[0].message).toBe("Invalid 'unit'.");
    expect(validationError.message).toBe('Validation failed for one or more variables.');
  });

  it('throws DiecutAuthError on 401 and 403', async () => {
    const client401 = new ApiHttpClient({
      baseUrl: BASE_URL,
      apiKey: 'key123',
      apiVersionHeader: 'Dielines-Api-Version',
      fetchImpl: mockFetchOnce(401, { message: 'Unauthorized' }),
    });
    await expect(client401.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      DiecutAuthError,
    );

    const client403 = new ApiHttpClient({
      baseUrl: BASE_URL,
      apiKey: 'key123',
      apiVersionHeader: 'Dielines-Api-Version',
      fetchImpl: mockFetchOnce(403, { message: 'Forbidden' }),
    });
    await expect(client403.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      DiecutAuthError,
    );
  });

  it('throws DiecutNotFoundError on 404', async () => {
    const client = new ApiHttpClient({
      baseUrl: BASE_URL,
      apiKey: 'key123',
      apiVersionHeader: 'Dielines-Api-Version',
      fetchImpl: mockFetchOnce(404, { message: 'Resource cannot be found' }),
    });
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      DiecutNotFoundError,
    );
  });

  it('uses {message: statusText} when the error body cannot be parsed as JSON', async () => {
    const fetchImpl = mockFetchOnce(500, undefined, {
      invalidJson: true,
      statusText: 'Internal Server Error',
    });
    const client = new ApiHttpClient({
      baseUrl: BASE_URL,
      apiKey: 'key123',
      apiVersionHeader: 'Dielines-Api-Version',
      fetchImpl,
    });
    const promise = client.request({ method: 'GET', path: '/x' });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DiecutApiError);
    expect((error as DiecutApiError).body).toEqual({ message: 'Internal Server Error' });
  });
});
