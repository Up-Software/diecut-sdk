import { describe, it, expect } from 'vitest';
import { DielinesClient } from '../src/dielines/client';
import { DimensionsClient } from '../src/dimensions/client';
import { DiecutAuthError } from '../src/errors';
import { mockFetchOnce } from './helpers';

describe('getCredits', () => {
  it('DielinesClient: GET /credits maps a credit-based Dielines balance', async () => {
    const fetchImpl = mockFetchOnce(200, {
      credits: {
        type: 'credits',
        product: 'dielines',
        available: 137,
        expires_at: '2027-03-14T09:20:00Z',
        borrowed: 0,
        borrowable: 6,
      },
    });
    const client = new DielinesClient({ apiKey: 'k', environment: 'sandbox', fetchImpl });

    const credits = await client.getCredits();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://sandbox.api.diecuttemplates.com/credits');
    expect(init.method).toBe('GET');
    expect(init.headers['Dielines-Api-Version']).toBe('1.0');
    expect(credits).toEqual({
      type: 'credits',
      product: 'dielines',
      available: 137,
      expiresAt: '2027-03-14T09:20:00Z',
      borrowed: 0,
      borrowable: 6,
      unlimited: false,
    });
  });

  it('DielinesClient: an unlimited account has expiresAt null and unlimited true', async () => {
    const fetchImpl = mockFetchOnce(200, {
      credits: {
        type: 'credits',
        product: 'dielines',
        available: 0,
        expires_at: null,
        unlimited: true,
      },
    });
    const credits = await new DielinesClient({ apiKey: 'k', fetchImpl }).getCredits();
    expect(credits.available).toBe(0);
    expect(credits.expiresAt).toBeNull();
    expect(credits.unlimited).toBe(true);
    expect(credits.borrowed).toBeUndefined();
    expect(credits.borrowable).toBeUndefined();
  });

  it('DimensionsClient: GET /dimensions/credits uses the Dimensions version header', async () => {
    const fetchImpl = mockFetchOnce(200, {
      credits: {
        type: 'credits',
        product: 'dimensions',
        available: '542',
        expires_at: '2026-12-20T09:20:00Z',
      },
    });
    const client = new DimensionsClient({ apiKey: 'dim_k', fetchImpl });

    const credits = await client.getCredits();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.diecuttemplates.com/dimensions/credits');
    expect(init.headers['Dimensions-Api-Version']).toBe('1.0');
    expect(credits.product).toBe('dimensions');
    expect(credits.available).toBe(542);
    expect(credits.unlimited).toBe(false);
  });

  it('DimensionsClient: 401 throws DiecutAuthError', async () => {
    const fetchImpl = mockFetchOnce(401, { message: 'Unauthorized' });
    await expect(
      new DimensionsClient({ apiKey: 'bad', fetchImpl }).getCredits(),
    ).rejects.toBeInstanceOf(DiecutAuthError);
  });
});
