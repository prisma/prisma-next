import type {
  DataTransformOperation,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';
import { MigrationToolsError } from '../src/errors';
import { deriveProvidedInvariants, validateInvariantId } from '../src/invariants';

function dataOp(name: string, invariantId?: string): DataTransformOperation {
  return {
    id: `data.${name}`,
    label: `Data: ${name}`,
    operationClass: 'data',
    name,
    ...ifDefined('invariantId', invariantId),
    source: 'migration.ts',
    check: null,
    run: null,
  };
}

function nonDataOp(id: string): MigrationPlanOperation {
  return { id, label: id, operationClass: 'additive' };
}

describe('validateInvariantId', () => {
  it.each([
    'a',
    'backfill-user-phone',
    'users/backfill-phone',
    'env/staging/clean-emails',
    'BackfillUserPhone',
    'users.phone_backfill',
    'migration:042/cleanup',
    '-leading-hyphen',
    'trailing-hyphen-',
    'two..dots',
    'double//slash',
    '.dot-start',
    'naïve-cafe', // non-ASCII Unicode is the author's call
  ])('accepts valid id %s', (id) => {
    expect(validateInvariantId(id)).toBe(true);
  });

  it.each([
    '',
    ' ',
    'with space',
    'tab\there',
    'newline\nhere',
    '\r',
    '\x00null',
    '\x7Fdel',
    'with nbsp',
    'with emspace',
    'with lineSep',
  ])('rejects invalid id %s', (id) => {
    expect(validateInvariantId(id)).toBe(false);
  });
});

describe('deriveProvidedInvariants', () => {
  it('returns empty when no ops have invariantId', () => {
    expect(deriveProvidedInvariants([nonDataOp('add-table'), dataOp('cleanup')])).toEqual([]);
  });

  it('skips non-data ops', () => {
    expect(
      deriveProvidedInvariants([
        nonDataOp('add-table'),
        // additive ops with stray invariantId-like fields are ignored
        { ...nonDataOp('phantom'), invariantId: 'should-be-ignored' } as MigrationPlanOperation,
        dataOp('phone-backfill', 'phone-backfill'),
      ]),
    ).toEqual(['phone-backfill']);
  });

  it('returns sorted, deduplicated invariantIds across data ops', () => {
    expect(
      deriveProvidedInvariants([dataOp('z', 'zebra'), dataOp('a', 'apple'), dataOp('m', 'mango')]),
    ).toEqual(['apple', 'mango', 'zebra']);
  });

  it('throws INVALID_INVARIANT_ID on a malformed id', () => {
    expect(() => deriveProvidedInvariants([dataOp('with space', 'has a space')])).toThrowError(
      expect.objectContaining({
        code: 'MIGRATION.INVALID_INVARIANT_ID',
        details: { invariantId: 'has a space' },
      }) as unknown as Error,
    );
  });

  it('throws DUPLICATE_INVARIANT_IN_EDGE when two data ops share an invariantId', () => {
    let caught: unknown;
    try {
      deriveProvidedInvariants([
        dataOp('first-cleanup', 'shared'),
        dataOp('second-cleanup', 'shared'),
      ]);
    } catch (e) {
      caught = e;
    }
    expect(MigrationToolsError.is(caught)).toBe(true);
    if (MigrationToolsError.is(caught)) {
      expect(caught.code).toBe('MIGRATION.DUPLICATE_INVARIANT_IN_EDGE');
      expect(caught.details).toEqual({ invariantId: 'shared' });
    }
  });
});
