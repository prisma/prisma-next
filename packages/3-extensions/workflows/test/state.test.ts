import { describe, expect, it } from 'vitest';
import { flattenState, hydrateState } from '../src/persistence/state';

describe('flattenState', () => {
  it('encodes a string field', () => {
    const rows = flattenState('run-1', { email: 'user@example.com' });
    expect(rows).toEqual([
      {
        runId: 'run-1',
        fieldName: 'email',
        fieldKind: 'string',
        stringValue: 'user@example.com',
        numberValue: null,
        booleanValue: null,
      },
    ]);
  });

  it('encodes a number field', () => {
    const rows = flattenState('run-1', { retryCount: 3 });
    expect(rows).toEqual([
      {
        runId: 'run-1',
        fieldName: 'retryCount',
        fieldKind: 'number',
        stringValue: null,
        numberValue: 3,
        booleanValue: null,
      },
    ]);
  });

  it('encodes a boolean field', () => {
    const rows = flattenState('run-1', { approved: true });
    expect(rows).toEqual([
      {
        runId: 'run-1',
        fieldName: 'approved',
        fieldKind: 'boolean',
        stringValue: null,
        numberValue: null,
        booleanValue: true,
      },
    ]);
  });

  it('encodes a null field', () => {
    const rows = flattenState('run-1', { userId: null });
    expect(rows).toEqual([
      {
        runId: 'run-1',
        fieldName: 'userId',
        fieldKind: 'null',
        stringValue: null,
        numberValue: null,
        booleanValue: null,
      },
    ]);
  });

  it('encodes multiple fields', () => {
    const rows = flattenState('run-2', { email: 'a@b.com', count: 1, active: false });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.fieldName)).toEqual(['email', 'count', 'active']);
  });

  it('produces an empty array for an empty state', () => {
    expect(flattenState('run-1', {})).toEqual([]);
  });
});

describe('hydrateState', () => {
  it('decodes a string row', () => {
    const state = hydrateState([
      {
        fieldName: 'email',
        fieldKind: 'string',
        stringValue: 'user@example.com',
        numberValue: null,
        booleanValue: null,
      },
    ]);
    expect(state).toEqual({ email: 'user@example.com' });
  });

  it('decodes a number row', () => {
    const state = hydrateState([
      {
        fieldName: 'retryCount',
        fieldKind: 'number',
        stringValue: null,
        numberValue: 3,
        booleanValue: null,
      },
    ]);
    expect(state).toEqual({ retryCount: 3 });
  });

  it('decodes a boolean row', () => {
    const state = hydrateState([
      {
        fieldName: 'approved',
        fieldKind: 'boolean',
        stringValue: null,
        numberValue: null,
        booleanValue: true,
      },
    ]);
    expect(state).toEqual({ approved: true });
  });

  it('decodes a null row', () => {
    const state = hydrateState([
      {
        fieldName: 'userId',
        fieldKind: 'null',
        stringValue: null,
        numberValue: null,
        booleanValue: null,
      },
    ]);
    expect(state).toEqual({ userId: null });
  });

  it('decodes multiple rows', () => {
    const state = hydrateState([
      {
        fieldName: 'email',
        fieldKind: 'string',
        stringValue: 'a@b.com',
        numberValue: null,
        booleanValue: null,
      },
      {
        fieldName: 'count',
        fieldKind: 'number',
        stringValue: null,
        numberValue: 1,
        booleanValue: null,
      },
    ]);
    expect(state).toEqual({ email: 'a@b.com', count: 1 });
  });

  it('returns an empty object for no rows', () => {
    expect(hydrateState([])).toEqual({});
  });

  it('round-trips through flattenState', () => {
    const original = { email: 'x@y.com', score: 42, active: false, notes: null };
    const rows = flattenState('run-rt', original);
    const hydrated = hydrateState(rows);
    expect(hydrated).toEqual(original);
  });
});
