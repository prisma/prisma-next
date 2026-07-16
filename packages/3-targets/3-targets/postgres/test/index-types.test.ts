/**
 * Postgres index-type registration (TML-3037, dispatch D5).
 *
 * `contract infer` prints `@@index(..., type: "gin"/"hash")` for a non-default
 * access method, but the postgres target registered zero index types, so
 * `validateIndexTypes` rejected every non-btree index at emit. These tests
 * prove: (1) the registry itself carries the six Postgres built-in access
 * methods with permissive options, and (2) a real PSL interpret → build pass
 * accepts a `gin`/`hash` index end-to-end while still rejecting a bogus type
 * — registering real methods must not disable the check.
 */
import { assembleAuthoringContributions } from '@prisma-next/framework-components/control';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { postgresTargetDescriptorMeta } from '../src/core/descriptor-meta';
import { postgresIndexTypes } from '../src/core/index-types';
import { type PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    },
  },
]);

const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
]);

function interpret(source: string) {
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes: [...scalarTypeDescriptors.keys()],
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    capabilities: {},
    target: postgresTargetDescriptorMeta,
    scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
  });
}

function modelWithIndexType(indexType: string): string {
  return `
model Widgets {
  id   Int @id
  code Int
  @@index([code], type: "${indexType}")
}
`;
}

describe('postgresIndexTypes', () => {
  it('registers the six Postgres built-in access methods', () => {
    expect(postgresIndexTypes.entries.map((e) => e.type)).toEqual([
      'btree',
      'hash',
      'gin',
      'gist',
      'spgist',
      'brin',
    ]);
  });

  it('accepts an arbitrary options object for every registered method (permissive; per-method validation is a later slice)', () => {
    for (const entry of postgresIndexTypes.entries) {
      const result = entry.options({ anything: 'goes' });
      expect(result instanceof type.errors).toBe(false);
    }
  });
});

describe('postgresTargetDescriptorMeta', () => {
  it('declares its index types via postgresIndexTypes', () => {
    expect(postgresTargetDescriptorMeta.indexTypes).toBe(postgresIndexTypes);
  });
});

describe('contract build registers postgres index types end-to-end', () => {
  it('accepts @@index(..., type: "gin")', () => {
    const result = interpret(modelWithIndexType('gin'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns.table['widgets']?.indexes.map((idx) => idx.type)).toEqual(['gin']);
  });

  it('accepts @@index(..., type: "hash")', () => {
    const result = interpret(modelWithIndexType('hash'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns.table['widgets']?.indexes.map((idx) => idx.type)).toEqual(['hash']);
  });

  it('still rejects a bogus, unregistered index type — registering real methods does not disable the check', () => {
    expect(() => interpret(modelWithIndexType('bogus'))).toThrow(/unregistered index type "bogus"/);
  });
});
