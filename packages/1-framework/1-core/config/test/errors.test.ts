import { describe, expect, it } from 'vitest';
import { ConfigValidationError } from '../src/errors';

describe('ConfigValidationError', () => {
  it('builds a default message from the field when why is omitted', () => {
    const error = new ConfigValidationError('contract');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConfigValidationError');
    expect(error.message).toBe('Config must have a "contract" field');
    expect(error.field).toBe('contract');
    expect(error.why).toBe('Config must have a "contract" field');
  });

  it('uses the explicit why for both message and why when provided', () => {
    const error = new ConfigValidationError('contract.output', 'output collides with input');

    expect(error.message).toBe('output collides with input');
    expect(error.field).toBe('contract.output');
    expect(error.why).toBe('output collides with input');
  });
});
