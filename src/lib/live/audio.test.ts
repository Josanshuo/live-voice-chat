import { describe, it, expect } from 'vitest';
import { resampleLinear, pcm16ToBase64, base64ToFloat32 } from './audio';

describe('audio helpers', () => {
  it('pcm16 encode/decode round-trips within quantization error', () => {
    const input = new Float32Array([0, 0.5, -0.5, 0.999, -1, 0.25]);
    const decoded = base64ToFloat32(pcm16ToBase64(input));
    expect(decoded.length).toBe(input.length);
    // int16 quantization truncates, so error can reach ~2 LSB (2/32768)
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(decoded[i] - input[i])).toBeLessThan(1 / 16000);
    }
  });

  it('pcm16 encoding clamps out-of-range samples', () => {
    const decoded = base64ToFloat32(pcm16ToBase64(new Float32Array([2, -2])));
    expect(decoded[0]).toBeCloseTo(1, 2);
    expect(decoded[1]).toBeCloseTo(-1, 2);
  });

  it('resampleLinear halves the sample count from 48k to 24k', () => {
    const input = new Float32Array(960).map((_, i) => Math.sin(i / 10));
    const out = resampleLinear(input, 48000, 24000);
    expect(out.length).toBe(480);
  });

  it('resampleLinear is identity at equal rates', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleLinear(input, 24000, 24000)).toBe(input);
  });

  it('resampleLinear preserves a constant signal', () => {
    const input = new Float32Array(300).fill(0.7);
    const out = resampleLinear(input, 24000, 16000);
    expect(out.length).toBe(200);
    for (const v of out) expect(v).toBeCloseTo(0.7, 5);
  });
});
