import type { AuthoringTypeNamespace } from '@prisma-next/framework-components/authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { assembleAuthoringContributions } from '@prisma-next/framework-components/control';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../../src/core/authoring';
import { type PostgresSchema, postgresCreateNamespace } from '../../src/core/postgres-schema';
import { printPslFromFlat } from './fixtures';

const authoringTypes = {
  Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
  Uuid: { kind: 'typeConstructor', output: { codecId: 'pg/uuid@1', nativeType: 'uuid' } },
  Numeric: {
    kind: 'typeConstructor',
    args: [
      { kind: 'number', name: 'precision', integer: true, minimum: 1, optional: true },
      { kind: 'number', name: 'scale', integer: true, minimum: 0, optional: true },
    ],
    output: {
      codecId: 'pg/numeric@1',
      nativeType: 'numeric',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  Json: { kind: 'typeConstructor', output: { codecId: 'pg/json@1', nativeType: 'json' } },
  Jsonb: { kind: 'typeConstructor', output: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' } },
} as const satisfies AuthoringTypeNamespace;

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      type: authoringTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    },
  },
]);

const target = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
  authoring: { type: authoringTypes },
};

const codecLookup: CodecLookup = {
  get: () => undefined,
  targetTypesFor: () => undefined,
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
  descriptorFor: () => undefined,
};

function parseAndEmit(source: string) {
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    capabilities: {},
    target,
    scalarColumnDescriptors: new Map([
      ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
      ['Uuid', { codecId: 'pg/uuid@1', nativeType: 'uuid' }],
      ['Json', { codecId: 'pg/json@1', nativeType: 'json' }],
      ['Jsonb', { codecId: 'pg/jsonb@1', nativeType: 'jsonb' }],
    ]),
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup,
  });
}

describe('Postgres PSL inference round trip', () => {
  it('preserves unparameterized, parameterized, json, and jsonb storage', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        sample: {
          name: 'sample',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            uuid_value: { name: 'uuid_value', nativeType: 'uuid', nullable: false },
            amount: { name: 'amount', nativeType: 'numeric(10,2)', nullable: false },
            json_value: { name: 'json_value', nativeType: 'json', nullable: false },
            jsonb_value: { name: 'jsonb_value', nativeType: 'jsonb', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const inferred = printPslFromFlat(schemaIR);
    expect(inferred).toContain('UuidValue = Uuid');
    expect(inferred).toContain('Amount = Numeric(10, 2)');
    expect(inferred).toContain('JsonValue = Json');
    expect(inferred).toContain('jsonbValue Jsonb');

    const emitted = parseAndEmit(inferred);
    if (!emitted.ok) {
      expect(emitted.failure.diagnostics).toEqual([]);
      return;
    }

    const storage = emitted.value.storage as SqlStorage;
    const namespace = storage.namespaces['public'] as PostgresSchema;
    expect(namespace.table['sample']?.columns).toMatchObject({
      uuid_value: { codecId: 'pg/uuid@1', nativeType: 'uuid' },
      amount: {
        codecId: 'pg/numeric@1',
        nativeType: 'numeric',
        typeRef: 'Amount',
      },
      json_value: { codecId: 'pg/json@1', nativeType: 'json' },
      jsonb_value: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' },
    });
    expect(storage.types?.['Amount']).toMatchObject({
      codecId: 'pg/numeric@1',
      nativeType: 'numeric',
      typeParams: { precision: 10, scale: 2 },
    });
  });
});
