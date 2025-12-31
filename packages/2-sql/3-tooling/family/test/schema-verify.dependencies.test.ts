import { describe, expect, it } from 'vitest';
import type { ComponentDatabaseDependency } from '../src/core/migrations/types';
import { verifyDatabaseDependencies } from '../src/core/schema-verify/verify-helpers';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

/**
 * Creates a test database dependency that checks for a specific extension.
 */
function createExtensionDependency(
  extensionName: string,
  label: string,
): ComponentDatabaseDependency<unknown> {
  return {
    id: `postgres.extension.${extensionName}`,
    label,
    install: [
      {
        id: `extension.${extensionName}`,
        label: `Enable extension "${extensionName}"`,
        operationClass: 'additive',
        target: { id: 'postgres' },
        precheck: [],
        execute: [
          {
            description: `create extension "${extensionName}"`,
            sql: `CREATE EXTENSION IF NOT EXISTS ${extensionName}`,
          },
        ],
        postcheck: [],
      },
    ],
    verifyDatabaseDependenciesInstalled: (schema) => {
      if (!schema.extensions.includes(extensionName)) {
        return [
          {
            kind: 'extension_missing',
            table: '',
            message: `Extension "${extensionName}" is missing from database`,
          },
        ];
      }
      return [];
    },
  };
}

describe('verifyDatabaseDependencies', () => {
  it('returns empty nodes when no dependencies', () => {
    const schema = createTestSchemaIR({});
    const issues: Parameters<typeof verifyDatabaseDependencies>[2] = [];

    const nodes = verifyDatabaseDependencies([], schema, issues);

    expect(nodes).toHaveLength(0);
    expect(issues).toHaveLength(0);
  });

  it('returns pass nodes when all dependencies are satisfied', () => {
    const schema = createTestSchemaIR({}, ['vector', 'postgis']);
    const issues: Parameters<typeof verifyDatabaseDependencies>[2] = [];
    const dependencies = [
      createExtensionDependency('vector', 'Enable vector extension'),
      createExtensionDependency('postgis', 'Enable PostGIS'),
    ];

    const nodes = verifyDatabaseDependencies(dependencies, schema, issues);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      status: 'pass',
      name: 'Enable vector extension',
    });
    expect(nodes[1]).toMatchObject({
      status: 'pass',
      name: 'Enable PostGIS',
    });
    expect(issues).toHaveLength(0);
  });

  it('returns fail nodes when dependencies are missing', () => {
    const schema = createTestSchemaIR({}, []); // No extensions installed
    const issues: Parameters<typeof verifyDatabaseDependencies>[2] = [];
    const dependencies = [createExtensionDependency('vector', 'Enable vector extension')];

    const nodes = verifyDatabaseDependencies(dependencies, schema, issues);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      status: 'fail',
      name: 'Enable vector extension',
      code: 'dependency_missing',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'extension_missing',
      message: 'Extension "vector" is missing from database',
    });
  });

  it('returns mixed nodes when some dependencies are satisfied', () => {
    const schema = createTestSchemaIR({}, ['vector']); // Only vector installed
    const issues: Parameters<typeof verifyDatabaseDependencies>[2] = [];
    const dependencies = [
      createExtensionDependency('vector', 'Enable vector extension'),
      createExtensionDependency('postgis', 'Enable PostGIS'),
    ];

    const nodes = verifyDatabaseDependencies(dependencies, schema, issues);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      status: 'pass',
      name: 'Enable vector extension',
    });
    expect(nodes[1]).toMatchObject({
      status: 'fail',
      name: 'Enable PostGIS',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'extension_missing',
      message: 'Extension "postgis" is missing from database',
    });
  });
});

describe('verifySqlSchema with databaseDependencies', () => {
  it('uses databaseDependencies when provided', () => {
    const contract = createTestContract({
      user: createContractTable({
        id: { nativeType: 'int4', nullable: false },
      }),
    });

    const schema = createTestSchemaIR(
      {
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
        }),
      },
      ['vector'],
    );

    const dependencies = [createExtensionDependency('vector', 'Enable vector extension')];

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      databaseDependencies: dependencies,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('fails when databaseDependencies are not satisfied', () => {
    const contract = createTestContract({
      user: createContractTable({
        id: { nativeType: 'int4', nullable: false },
      }),
    });

    const schema = createTestSchemaIR(
      {
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
        }),
      },
      [], // No extensions installed
    );

    const dependencies = [createExtensionDependency('vector', 'Enable vector extension')];

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      databaseDependencies: dependencies,
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'extension_missing',
        message: 'Extension "vector" is missing from database',
      }),
    );
  });

  it('falls back to deprecated verifyExtensions when no databaseDependencies', () => {
    const contract = createTestContract(
      {
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
        }),
      },
      { pgvector: {} }, // Extension in contract
    );

    const schema = createTestSchemaIR(
      {
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
        }),
      },
      ['vector'], // vector extension installed (matches pgvector via fuzzy matching)
    );

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      // No databaseDependencies - falls back to deprecated verifyExtensions
    });

    expect(result.ok).toBe(true);
  });
});
