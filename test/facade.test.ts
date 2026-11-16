import { describe, it, expect } from 'vitest';
import { DiecutTemplatesSDK, DielinesClient, DimensionsClient } from '../src/index';

describe('DiecutTemplatesSDK facade', () => {
  it('creates each client lazily and reuses the same instance', () => {
    const sdk = new DiecutTemplatesSDK({
      dielinesApiKey: 'a',
      dimensionsApiKey: 'dim_b',
      environment: 'sandbox',
    });
    expect(sdk.dielines).toBeInstanceOf(DielinesClient);
    expect(sdk.dielines).toBe(sdk.dielines);
    expect(sdk.dimensions).toBeInstanceOf(DimensionsClient);
    expect(sdk.dimensions).toBe(sdk.dimensions);
  });

  it('throws a clear error when a key is missing', () => {
    const sdk = new DiecutTemplatesSDK({});
    expect(() => sdk.dielines).toThrow(/dielinesApiKey/);
    expect(() => sdk.dimensions).toThrow(/dimensionsApiKey/);
  });
});
