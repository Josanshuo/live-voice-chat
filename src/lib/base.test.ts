import { describe, it, expect } from 'vitest';
import { withBase } from './base';

describe('withBase', () => {
  it('should append path correctly', () => {
    // In vitest using vite.config.ts, import.meta.env.BASE_URL defaults to "/" unless VITE_BASE_PATH is set.
    // "/" replaced with empty string is "", plus "/test" is "/test"
    expect(withBase('/api/health')).toBe('/api/health');
  });
});
