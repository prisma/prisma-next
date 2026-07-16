import type {
  DiffableNode,
  SchemaChangeKind,
  SchemaDiffIssue,
} from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  classifyStorageTypeDiffIssue,
  verifierDisposition,
} from '../src/core/diff/verifier-disposition';

const NODE: DiffableNode = {
  id: 'user_status',
  nodeKind: 'sql-native-enum',
  isEqualTo: () => true,
  children: () => [],
};

/** Builds a storage-type diff issue whose change kind derives from presence. */
function issue(change: SchemaChangeKind): SchemaDiffIssue {
  return {
    path: ['user_status'],
    ...(change !== 'drop' ? { expected: NODE } : {}),
    ...(change !== 'create' ? { actual: NODE } : {}),
  };
}

describe('classifyStorageTypeDiffIssue', () => {
  it('classifies not-found as declared-missing', () => {
    expect(classifyStorageTypeDiffIssue(issue('create'))).toBe('declaredMissing');
  });

  it('classifies not-expected as extra-auxiliary', () => {
    expect(classifyStorageTypeDiffIssue(issue('drop'))).toBe('extraAuxiliary');
  });

  it('classifies not-equal as value drift', () => {
    expect(classifyStorageTypeDiffIssue(issue('alter'))).toBe('valueDrift');
  });
});

describe('verifierDisposition', () => {
  it('fails a missing type under managed', () => {
    expect(verifierDisposition('managed', issue('create'))).toBe('fail');
  });

  it('fails a value-set change under managed and tolerated', () => {
    expect(verifierDisposition('managed', issue('alter'))).toBe('fail');
    expect(verifierDisposition('tolerated', issue('alter'))).toBe('fail');
  });

  it('suppresses a value-set change under external (an external owner controls the allowed values)', () => {
    expect(verifierDisposition('external', issue('alter'))).toBe('suppress');
  });

  it('still requires an external type to exist', () => {
    expect(verifierDisposition('external', issue('create'))).toBe('fail');
  });

  it('suppresses an extra type under external', () => {
    expect(verifierDisposition('external', issue('drop'))).toBe('suppress');
  });

  it('warns on every reason under observed', () => {
    expect(verifierDisposition('observed', issue('create'))).toBe('warn');
    expect(verifierDisposition('observed', issue('drop'))).toBe('warn');
    expect(verifierDisposition('observed', issue('alter'))).toBe('warn');
  });
});
