import { describe, expect, it } from 'vitest';
import { planInvalid, planUnsupported } from '../src/errors';

describe('planInvalid', () => {
  it('creates error with correct structural properties', () => {
    const error = planInvalid('Test error message');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RuntimeError');
    expect(error.message).toBe('Test error message');
    expect(error.code).toBe('PLAN.INVALID');
    expect(error.category).toBe('PLAN');
    expect(error.severity).toBe('error');
  });

  it('includes optional details, hints, and docs', () => {
    const error = planInvalid('fail', { key: 'value' }, ['hint1', 'hint2'], ['doc1']);
    expect(error.details).toEqual({ key: 'value' });
    expect(error.hints).toEqual(['hint1', 'hint2']);
    expect(error.docs).toEqual(['doc1']);
  });

  it('omits optional fields when not provided', () => {
    const error = planInvalid('fail');
    expect(error.details).toBeUndefined();
    expect(error.hints).toBeUndefined();
    expect(error.docs).toBeUndefined();
  });
});

describe('planUnsupported', () => {
  it('creates error with correct structural properties', () => {
    const error = planUnsupported('Test error message');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RuntimeError');
    expect(error.message).toBe('Test error message');
    expect(error.code).toBe('PLAN.UNSUPPORTED');
    expect(error.category).toBe('PLAN');
    expect(error.severity).toBe('error');
  });

  it('includes optional details, hints, and docs', () => {
    const error = planUnsupported('fail', { key: 'value' }, ['hint1'], ['doc1', 'doc2']);
    expect(error.details).toEqual({ key: 'value' });
    expect(error.hints).toEqual(['hint1']);
    expect(error.docs).toEqual(['doc1', 'doc2']);
  });
});
