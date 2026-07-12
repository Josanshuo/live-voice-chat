import { describe, it, expect, vi, afterEach } from 'vitest';
import { withBase } from './base';

describe('withBase', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the path unchanged at the root base ("/")', () => {
    expect(withBase('/api/health')).toBe('/api/health');
  });

  // The reason withBase exists: deployed builds live under /voice/
  // (VITE_BASE_PATH), and every same-origin URL must carry the prefix.
  it('prefixes the sub-path when deployed under /voice/', () => {
    vi.stubEnv('BASE_URL', '/voice/');
    expect(withBase('/api/health')).toBe('/voice/api/health');
    expect(withBase('/voice-previews/openai/marin.mp3')).toBe(
      '/voice/voice-previews/openai/marin.mp3'
    );
  });

  it('does not double the slash for a base without trailing slash', () => {
    vi.stubEnv('BASE_URL', '/voice');
    expect(withBase('/api/health')).toBe('/voice/api/health');
  });
});
