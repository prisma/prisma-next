import type { Contract } from '@prisma-next/contract/types';
import type {
  SchemaVerificationNode,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { entityNamesDeclaredBy, scopeVerifyResultToSpace } from '../src/core/scope-verify-result';

function makeContract(collections: readonly string[]): Contract {
  const entries: Record<string, Record<string, unknown>> = {
    collection: Object.fromEntries(collections.map((name) => [name, {}])),
  };
  return {
    storage: { namespaces: { mongo: { id: 'mongo', entries } } },
  } as unknown as Contract;
}

function collectionNode(
  name: string,
  status: SchemaVerificationNode['status'],
  children: SchemaVerificationNode[] = [],
): SchemaVerificationNode {
  return {
    status,
    kind: 'collection',
    name,
    contractPath: `storage.namespaces.mongo.entries.collection.${name}`,
    code: status === 'pass' ? 'MATCH' : 'EXTRA_COLLECTION',
    message: '',
    expected: undefined,
    actual: undefined,
    children,
  };
}

function makeResult(args: {
  ok: boolean;
  children: SchemaVerificationNode[];
  counts: VerifyDatabaseSchemaResult['schema']['counts'];
  issues?: VerifyDatabaseSchemaResult['schema']['issues'];
}): VerifyDatabaseSchemaResult {
  const rootStatus = args.children.some((c) => c.status === 'fail')
    ? 'fail'
    : args.children.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';
  return {
    ok: args.ok,
    ...(args.ok ? {} : { code: 'PN-RUN-3010' }),
    summary: args.ok ? 'Database schema satisfies contract' : 'does not satisfy',
    contract: { storageHash: 'sha256:x' },
    target: { expected: 'mongo' },
    schema: {
      issues: args.issues ?? [],
      schemaDiffIssues: [],
      root: {
        status: rootStatus,
        kind: 'schema',
        name: 'schema',
        contractPath: '',
        code: rootStatus === 'pass' ? 'MATCH' : 'DRIFT',
        message: '',
        expected: undefined,
        actual: undefined,
        children: args.children,
      },
      counts: args.counts,
    },
    timings: { total: 0 },
  };
}

describe('entityNamesDeclaredBy', () => {
  it('unions entity names across the given contracts', () => {
    const names = entityNamesDeclaredBy([
      makeContract(['cipher_state']),
      makeContract(['audit_log', 'cipher_state']),
    ]);
    expect([...names].sort()).toEqual(['audit_log', 'cipher_state']);
  });
});

describe('scopeVerifyResultToSpace', () => {
  it('returns the input unchanged when no names are owned by other spaces', () => {
    const result = makeResult({
      ok: true,
      children: [collectionNode('user', 'pass')],
      counts: { pass: 1, warn: 0, fail: 0, totalNodes: 1 },
    });
    expect(scopeVerifyResultToSpace(result, new Set())).toBe(result);
  });

  it('preserves the authoritative counts when a non-empty owned set drops nothing', () => {
    const result = makeResult({
      ok: true,
      children: [collectionNode('user', 'pass')],
      counts: { pass: 1, warn: 0, fail: 0, totalNodes: 1 },
    });
    const scoped = scopeVerifyResultToSpace(result, new Set(['cipher_state']));
    expect(scoped.schema.counts).toEqual({ pass: 1, warn: 0, fail: 0, totalNodes: 1 });
    expect(scoped.ok).toBe(true);
  });

  it('drops a sibling space’s collection, keeps the undeclared extra, and flips ok', () => {
    // Mongo basis: fail per collection, root not counted. Both extras fail.
    const result = makeResult({
      ok: false,
      children: [
        collectionNode('user', 'pass'),
        collectionNode('cipher_state', 'fail'),
        collectionNode('junk', 'fail'),
      ],
      counts: { pass: 1, warn: 0, fail: 2, totalNodes: 3 },
      issues: [
        { kind: 'extra_table', table: 'cipher_state', message: 'extra' },
        { kind: 'extra_table', table: 'junk', message: 'extra' },
      ],
    });

    const scoped = scopeVerifyResultToSpace(result, new Set(['cipher_state']));

    // The sibling's collection is dropped; the truly undeclared `junk` stays,
    // so the runner still fails on genuine drift. Counts recompute on Mongo's
    // basis: one tally per collection, the root never counted.
    expect(scoped.schema.root.children.map((c) => c.name)).toEqual(['user', 'junk']);
    expect(scoped.schema.issues.map((i) => ('table' in i ? i.table : ''))).toEqual(['junk']);
    expect(scoped.schema.counts).toEqual({ pass: 1, warn: 0, fail: 1, totalNodes: 2 });
    expect(scoped.ok).toBe(false);
  });

  it('flips ok to true when the only failures were sibling collections', () => {
    const result = makeResult({
      ok: false,
      children: [collectionNode('user', 'pass'), collectionNode('cipher_state', 'fail')],
      counts: { pass: 1, warn: 0, fail: 1, totalNodes: 2 },
      issues: [{ kind: 'extra_table', table: 'cipher_state', message: 'extra' }],
    });

    const scoped = scopeVerifyResultToSpace(result, new Set(['cipher_state']));

    expect(scoped.ok).toBe(true);
    // Exact Mongo basis after the prune: the one surviving collection, root
    // excluded — not collection count + 1.
    expect(scoped.schema.counts).toEqual({ pass: 1, warn: 0, fail: 0, totalNodes: 1 });
    expect(scoped.schema.issues).toEqual([]);
  });

  it('never drops a space’s own field node named like a sibling collection', () => {
    const fieldNode: SchemaVerificationNode = {
      status: 'fail',
      kind: 'field',
      name: 'cipher_state',
      contractPath: 'storage.namespaces.mongo.entries.collection.user.fields.cipher_state',
      code: 'MISSING_FIELD',
      message: '',
      expected: undefined,
      actual: undefined,
      children: [],
    };
    const result = makeResult({
      ok: false,
      children: [collectionNode('user', 'fail', [fieldNode])],
      counts: { pass: 0, warn: 0, fail: 1, totalNodes: 2 },
      issues: [
        { kind: 'missing_column', table: 'user', column: 'cipher_state', message: 'missing' },
      ],
    });

    const scoped = scopeVerifyResultToSpace(result, new Set(['cipher_state']));

    // Only top-level collection nodes are droppable; the nested field node and
    // its failure survive, so the space still fails on its own drift.
    expect(scoped.schema.root.children.map((c) => c.name)).toEqual(['user']);
    expect(scoped.schema.root.children[0]?.children.map((c) => c.name)).toEqual(['cipher_state']);
    expect(scoped.ok).toBe(false);
  });
});
