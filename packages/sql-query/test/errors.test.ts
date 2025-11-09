import { describe, expect, it } from 'vitest';
import { planUnsupported } from '../src/errors';

describe('planUnsupported', () => {
  it('creates error with message', () => {
    const error = planUnsupported('Test error message');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Test error message');
    expect(error.code).toBe('PLAN.UNSUPPORTED');
    expect(error.category).toBe('PLAN');
    expect(error.severity).toBe('error');
  });

  it('creates error with details', () => {
    const error = planUnsupported('Test error', { key: 'value' });
    expect(error.details).toEqual({ key: 'value' });
  });

  it('creates error with hints', () => {
    const error = planUnsupported('Test error', undefined, ['hint1', 'hint2']);
    expect(error.hints).toEqual(['hint1', 'hint2']);
  });

  it('creates error with docs', () => {
    const error = planUnsupported('Test error', undefined, undefined, ['doc1', 'doc2']);
    expect(error.docs).toEqual(['doc1', 'doc2']);
  });

  it('creates error with all properties', () => {
    const error = planUnsupported('Test error', { key: 'value' }, ['hint1'], ['doc1']);
    expect(error.message).toBe('Test error');
    expect(error.details).toEqual({ key: 'value' });
    expect(error.hints).toEqual(['hint1']);
    expect(error.docs).toEqual(['doc1']);
  });
});
