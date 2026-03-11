import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
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
 * Creates a test database dependency for a specific extension.
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
    const schema = createTestSchemaIR({}, [
      { id: 'postgres.extension.vector' },
      { id: 'postgres.extension.postgis' },
    ]);
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
    const schema = createTestSchemaIR({}, []); // No dependencies installed
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
      kind: 'dependency_missing',
      message: 'Dependency "postgres.extension.vector" is missing from database',
    });
  });

  it('returns mixed nodes when some dependencies are satisfied', () => {
    const schema = createTestSchemaIR({}, [{ id: 'postgres.extension.vector' }]); // Only vector installed
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
      kind: 'dependency_missing',
      message: 'Dependency "postgres.extension.postgis" is missing from database',
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
      [{ id: 'postgres.extension.vector' }],
    );

    const dependencies = [createExtensionDependency('vector', 'Enable vector extension')];

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [
        {
          kind: 'extension',
          id: 'pgvector',
          familyId: 'sql',
          targetId: 'postgres',
          manifest: { id: 'pgvector', version: '0.0.0' },
          databaseDependencies: { init: dependencies },
        } as unknown as TargetBoundComponentDescriptor<'sql', 'postgres'>,
      ],
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
      [], // No dependencies installed
    );

    const dependencies = [createExtensionDependency('vector', 'Enable vector extension')];

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [
        {
          kind: 'extension',
          id: 'pgvector',
          familyId: 'sql',
          targetId: 'postgres',
          manifest: { id: 'pgvector', version: '0.0.0' },
          databaseDependencies: { init: dependencies },
        } as unknown as TargetBoundComponentDescriptor<'sql', 'postgres'>,
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'dependency_missing',
        message: 'Dependency "postgres.extension.vector" is missing from database',
      }),
    );
  });

  it('throws error when contract extension is not present in frameworkComponents', () => {
    // Configuration integrity check: all extensions declared in the contract
    // must be present in frameworkComponents.
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
      [], // No dependencies installed
    );

    // This should throw because pgvector is in the contract but not in frameworkComponents
    expect(() =>
      verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [], // No extensions provided - configuration mismatch!
      }),
    ).toThrow(
      "Extension pack 'pgvector' is declared in the contract but not found in framework components",
    );
  });

  it('does not infer dependencies from contract extension packs (ADR 154)', () => {
    // Per ADR 154, we do NOT interpret contract extension packs as database prerequisites.
    // Dependencies are only collected from frameworkComponents.
    // However, we DO validate that extensions in the contract are present in frameworkComponents.
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
      [], // No dependencies installed
    );

    // Provide a pgvector extension descriptor WITHOUT database dependencies
    const pgvectorExtension = {
      kind: 'extension' as const,
      id: 'pgvector',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      // No databaseDependencies declared
    } as unknown as TargetBoundComponentDescriptor<'sql', 'postgres'>;

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [pgvectorExtension], // Extension present but no dependencies
    });

    // Verification should pass because:
    // 1. The extension is present in frameworkComponents (configuration integrity check passes)
    // 2. The extension has no database dependencies, so nothing to verify
    expect(result.ok).toBe(true);
  });
});
