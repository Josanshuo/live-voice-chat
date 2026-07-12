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

  it('should retrieve the grok provider', () => {
    expect(getProvider('grok').id).toBe('grok');
  });

  it('should throw an error for an unknown provider ID', () => {
    expect(() => getProvider('unknown-id')).toThrowError();
  });

  it('should have unique provider IDs', () => {
    const ids = providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Catches the most likely registration mistakes when a new backend
  // is added: defaults that point at models/voices the provider
  // doesn't actually offer.
  describe('provider invariants', () => {
    for (const p of providers) {
      it(`${p.id}: defaults exist in its own model/voice lists`, () => {
        expect(p.models.length).toBeGreaterThan(0);
        expect(p.models.some((m) => m.id === p.defaultModel)).toBe(true);
        expect(p.voices.length).toBeGreaterThan(0);
        expect(p.voices).toContain(p.defaultVoice);
        expect(p.label.length).toBeGreaterThan(0);
        for (const m of p.models) {
          expect(m.label.length).toBeGreaterThan(0);
        }
      });
    }
  });
});
