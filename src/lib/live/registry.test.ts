import { describe, it, expect } from 'vitest';
import { getProvider, providers } from './registry';

describe('registry', () => {
  it('should export a list of providers', () => {
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
  });

  it('should retrieve a provider by ID', () => {
    const provider = getProvider('openai');
    expect(provider).toBeDefined();
    expect(provider.id).toBe('openai');
  });

  it('should throw an error for an unknown provider ID', () => {
    expect(() => getProvider('unknown-id')).toThrowError();
  });
});
