import { describe, expect, it } from 'vitest';
import { param } from '../src/param.ts';

describe('param', () => {
  it('creates parameter with valid name', () => {
    const p = param('userId');
    expect(p.kind).toBe('param-placeholder');
    expect(p.name).toBe('userId');
  });

  it('throws error for empty string', () => {
    expect(() => {
      param('');
    }).toThrow('Parameter name must be a non-empty string');
  });

  it('throws error for non-string input', () => {
    expect(() => {
      param(null as unknown as string);
    }).toThrow('Parameter name must be a non-empty string');
  });
});
