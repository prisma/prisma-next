import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import type { SqlContract, SqlMappings, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';
import type { CodecTypes } from './fixtures/contract.d';
import { columnDescriptor } from './helpers/column-descriptor';

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const RUNTIME_MAPPING_KEYS: (keyof SqlMappings)[] = [
  'modelToTable',
  'tableToModel',
  'fieldToColumn',
  'columnToField',
];

function assertCompatibleRuntimeShape(contract: SqlContract<SqlStorage>, label: string): void {
  expect(contract.mappings, `${label}: mappings`).toBeDefined();
  const mappingKeys = Object.keys(contract.mappings) as (keyof SqlMappings)[];
  for (const key of mappingKeys) {
    expect(RUNTIME_MAPPING_KEYS, `${label}: mapping key ${String(key)}`).toContain(key);
  }
  expect(contract, `${label}: _generated absent`).not.toHaveProperty('_generated');
}

describe('validateContract and defineContract parity', () => {
  it('defineContract().build() produces compatible runtime-real contract shape', () => {
    const built = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column })
          .primaryKey(['id'])
          .column('email', { type: textColumn }),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    assertCompatibleRuntimeShape(built, 'defineContract');
    expect(built.mappings.modelToTable).toBeDefined();
    expect(built.mappings.tableToModel).toBeDefined();
  });

  it('validateContract produces compatible runtime-real contract shape', () => {
    const contractJson = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };

    const validated = validateContract<SqlContract<SqlStorage>>(contractJson);

    assertCompatibleRuntimeShape(validated, 'validateContract');
  });

  it('both paths produce traversable mappings with same structural keys', () => {
    const built = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column })
          .primaryKey(['id'])
          .column('email', { type: textColumn }),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    const contractJson = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };
    const validated = validateContract<SqlContract<SqlStorage>>(contractJson);

    const builtMappingKeys = Object.keys(built.mappings).sort();
    const validatedMappingKeys = Object.keys(validated.mappings).sort();

    expect(validatedMappingKeys).toEqual(builtMappingKeys);
    expect(builtMappingKeys).toEqual(
      expect.arrayContaining(['modelToTable', 'tableToModel', 'fieldToColumn', 'columnToField']),
    );
  });

  it('validateContract strips _generated from input', () => {
    const contractWithGenerated = {
      schemaVersion: '1',
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'sha256:test',
      _generated: { emittedAt: '2026-02-15', emitterVersion: '1.0.0' },
      models: {
        User: {
          storage: { table: 'user' },
          fields: { id: { column: 'id' }, email: { column: 'email' } },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    };

    const validated = validateContract<SqlContract<SqlStorage>>(contractWithGenerated);

    expect(validated).not.toHaveProperty('_generated');
  });
});
