import { describe, expect, it } from 'vitest';
import * as formatModule from '../../src/exports/format';

describe('format module exports', () => {
  it('exports format as a function', () => {
    expect(formatModule.format).toBeTypeOf('function');
  });

  it('exports PslFormatError as an Error subclass', () => {
    const error = new formatModule.PslFormatError([]);
    expect(error).toBeInstanceOf(Error);
    expect(error.diagnostics).toEqual([]);
  });
});
