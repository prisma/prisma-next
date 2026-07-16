import type {
  DiffableNode,
  SchemaChangeKind,
  SchemaDiffIssue,
} from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  classifyMongoDiffIssue,
  verifierDisposition,
} from '../src/core/schema-verify/verifier-disposition';

const NODE: DiffableNode = {
  id: 'x',
  nodeKind: 'mongo',
  isEqualTo: () => true,
  children: () => [],
};

/** Stamps `expected`/`actual` so the issue's change kind derives from presence. */
function withPresence(path: readonly string[], change: SchemaChangeKind): SchemaDiffIssue {
  return {
    path,
    ...(change !== 'drop' ? { expected: NODE } : {}),
    ...(change !== 'create' ? { actual: NODE } : {}),
  };
}

/** A whole-collection issue: path is exactly the collection name. */
function collectionIssue(change: SchemaChangeKind): SchemaDiffIssue {
  return withPresence(['users'], change);
}

/** An auxiliary (index/validator/options) issue: path is one segment deeper. */
function auxiliaryIssue(change: SchemaChangeKind): SchemaDiffIssue {
  return withPresence(['users', 'index:email'], change);
}

describe('classifyMongoDiffIssue', () => {
  it('classifies not-expected at collection depth as extra-top-level-object', () => {
    expect(classifyMongoDiffIssue(collectionIssue('drop'))).toBe('extraTopLevelObject');
  });

  it('classifies not-expected at auxiliary depth as extra-auxiliary (indexes, validators)', () => {
    expect(classifyMongoDiffIssue(auxiliaryIssue('drop'))).toBe('extraAuxiliary');
  });

  it('classifies not-found as declared-missing (collection, validator)', () => {
    expect(classifyMongoDiffIssue(collectionIssue('create'))).toBe('declaredMissing');
    expect(classifyMongoDiffIssue(auxiliaryIssue('create'))).toBe('declaredMissing');
  });

  it('classifies not-equal as declared-incompatible (index, validator/options mismatch)', () => {
    expect(classifyMongoDiffIssue(auxiliaryIssue('alter'))).toBe('declaredIncompatible');
  });
});

describe('verifierDisposition', () => {
  it('fails declared drift and extras under managed', () => {
    expect(verifierDisposition('managed', collectionIssue('create'))).toBe('fail');
    expect(verifierDisposition('managed', auxiliaryIssue('create'))).toBe('fail');
    expect(verifierDisposition('managed', auxiliaryIssue('alter'))).toBe('fail');
    expect(verifierDisposition('managed', auxiliaryIssue('drop'))).toBe('fail');
    expect(verifierDisposition('managed', collectionIssue('drop'))).toBe('fail');
  });

  it('fails extra auxiliaries under tolerated (no nested element on Mongo)', () => {
    expect(verifierDisposition('tolerated', auxiliaryIssue('drop'))).toBe('fail');
    expect(verifierDisposition('tolerated', collectionIssue('drop'))).toBe('fail');
    expect(verifierDisposition('tolerated', collectionIssue('create'))).toBe('fail');
    expect(verifierDisposition('tolerated', auxiliaryIssue('alter'))).toBe('fail');
  });

  it('suppresses extras under external, still fails declared drift', () => {
    expect(verifierDisposition('external', auxiliaryIssue('drop'))).toBe('suppress');
    expect(verifierDisposition('external', collectionIssue('drop'))).toBe('suppress');
    expect(verifierDisposition('external', collectionIssue('create'))).toBe('fail');
    expect(verifierDisposition('external', auxiliaryIssue('create'))).toBe('fail');
    expect(verifierDisposition('external', auxiliaryIssue('alter'))).toBe('fail');
  });

  it('warns on every emitted reason under observed', () => {
    expect(verifierDisposition('observed', collectionIssue('create'))).toBe('warn');
    expect(verifierDisposition('observed', collectionIssue('drop'))).toBe('warn');
    expect(verifierDisposition('observed', auxiliaryIssue('drop'))).toBe('warn');
    expect(verifierDisposition('observed', auxiliaryIssue('create'))).toBe('warn');
    expect(verifierDisposition('observed', auxiliaryIssue('alter'))).toBe('warn');
  });
});
