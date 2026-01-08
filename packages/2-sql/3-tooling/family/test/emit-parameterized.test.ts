import type { ContractIR } from '@prisma-next/contract/ir';
import type { TypeRenderEntry, TypeRenderer, TypesImportSpec } from '@prisma-next/contract/types';
import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import { createSqlFamilyInstance } from '../src/core/instance';

/**
 * Integration tests for parameterized codec emission plumbing.
 *
 * These tests verify that parameterized renderers flow correctly
 * from family instance creation through to contract emission.
 *
 * Key architecture notes:
 * - Parameterized type renderers are defined in `types.codecTypes.parameterized`
 * - Renderers are normalized to `TypeRenderEntry` by the assembly layer
 * - Type imports for parameterized types are defined in `types.codecTypes.parameterizedImports`
 */

function createMockTarget(): ControlTargetDescriptor<'sql', 'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({ familyId: 'sql' as const, targetId: 'postgres' as const }),
  };
}

function createMockAdapter(): ControlAdapterDescriptor<'sql', 'postgres'> {
  return {
    kind: 'adapter',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    types: {
      codecTypes: {
        import: {
          package: '@prisma-next/adapter-postgres/codec-types',
          named: 'CodecTypes',
          alias: 'PgCodecTypes',
        },
      },
    },
  };
}

interface ParameterizedCodecConfig {
  readonly codecId: string;
  readonly renderer: TypeRenderer;
  readonly typesImport?: TypesImportSpec;
}

function createMockExtensionWithParameterizedCodec(
  id: string,
  config: ParameterizedCodecConfig,
): ControlExtensionDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    types: {
      codecTypes: {
        parameterized: {
          [config.codecId]: config.renderer,
        },
        ...(config.typesImport ? { parameterizedImports: [config.typesImport] } : {}),
      },
    },
  };
}

function createMockExtensionWithParameterizedRenderer(
  id: string,
  codecId: string,
  renderer: TypeRenderEntry['render'],
): ControlExtensionDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    types: {
      codecTypes: {
        import: {
          package: `@prisma-next/extension-${id}/codec-types`,
          named: 'CodecTypes',
          alias: `${id.charAt(0).toUpperCase() + id.slice(1)}CodecTypes`,
        },
        typeImports: [
          {
            package: `@prisma-next/extension-${id}/codec-types`,
            named: 'Vector',
            alias: 'Vector',
          },
        ],
        parameterized: {
          [codecId]: renderer,
        },
      },
    },
  };
}

function createTestContractIR(
  overrides: Partial<ContractIR> & { coreHash?: string } = {},
): ContractIR & { coreHash?: string } {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    coreHash: 'sha256:placeholder',
    models: {},
    relations: {},
    storage: { tables: {} },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}

describe('emit parameterized codecs integration', () => {
  it('emits parameterized type via renderer in contract.d.ts', async () => {
    // Create an extension with a parameterized renderer
    const target = createMockTarget();
    const adapter = createMockAdapter();
    const extension = createMockExtensionWithParameterizedRenderer(
      'pgvector',
      'pg/vector@1',
      (params) => `Vector<${params['length']}>`,
    );

    const familyInstance = createSqlFamilyInstance({
      target,
      adapter,
      extensionPacks: [extension],
    });

    // Create a contract IR with a column using the parameterized codec
    const contractIR = createTestContractIR({
      models: {
        Embedding: {
          storage: { table: 'embedding' },
          fields: {
            id: { column: 'id' },
            vector: { column: 'vector' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          embedding: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              vector: {
                nativeType: 'vector(1536)',
                codecId: 'pg/vector@1',
                nullable: false,
                typeParams: { length: 1536 },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      extensionPacks: { pgvector: { version: '0.0.1' } },
    });

    // Emit the contract
    const result = await familyInstance.emitContract({ contractIR });

    // Verify the parameterized renderer produces the correct type
    expect(result.contractDts).toContain('readonly vector: Vector<1536>');

    // Verify the emitted contract imports the type used by the renderer
    expect(result.contractDts).toContain(
      "import type { Vector } from '@prisma-next/extension-pgvector/codec-types';",
    );

    // Extra type-only imports must not be intersected into `export type CodecTypes = ...`
    expect(result.contractDts).toContain(
      'export type CodecTypes = PgCodecTypes & PgvectorCodecTypes;',
    );
  });

  it('emits typesImport from parameterized codecs in contract.d.ts', async () => {
    // Create a parameterized codec config with typesImport
    const vectorCodecConfig: ParameterizedCodecConfig = {
      codecId: 'pg/vector@1',
      renderer: 'Vector<{{length}}>',
      typesImport: {
        package: '@prisma-next/extension-pgvector/vector-types',
        named: 'Vector',
        alias: 'PgVector',
      },
    };

    // Create family instance with the extension
    const target = createMockTarget();
    const adapter = createMockAdapter();
    const extension = createMockExtensionWithParameterizedCodec('pgvector', vectorCodecConfig);

    const familyInstance = createSqlFamilyInstance({
      target,
      adapter,
      extensionPacks: [extension],
    });

    // Create a contract IR with a column using the parameterized codec
    const contractIR = createTestContractIR({
      models: {
        Embedding: {
          storage: { table: 'embedding' },
          fields: {
            id: { column: 'id' },
            vector: { column: 'vector' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          embedding: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              vector: {
                nativeType: 'vector(1536)',
                codecId: 'pg/vector@1',
                nullable: false,
                typeParams: { length: 1536 },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      extensionPacks: { pgvector: { version: '0.0.1' } },
    });

    // Emit the contract
    const result = await familyInstance.emitContract({ contractIR });

    // Verify the parameterized codec's typesImport appears in contract.d.ts
    expect(result.contractDts).toContain(
      "import type { Vector as PgVector } from '@prisma-next/extension-pgvector/vector-types'",
    );
  });

  it('uses standard CodecTypes lookup for columns without typeParams', async () => {
    const target = createMockTarget();
    const adapter = createMockAdapter();
    const extension = createMockExtensionWithParameterizedRenderer(
      'pgvector',
      'pg/vector@1',
      (params) => `Vector<${params['length']}>`,
    );

    const familyInstance = createSqlFamilyInstance({
      target,
      adapter,
      extensionPacks: [extension],
    });

    // Contract with columns WITHOUT typeParams
    const contractIR = createTestContractIR({
      models: {
        User: {
          storage: { table: 'user' },
          fields: {
            id: { column: 'id' },
            name: { column: 'name' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const result = await familyInstance.emitContract({ contractIR });

    // Standard columns should use CodecTypes lookup
    expect(result.contractDts).toContain("readonly id: CodecTypes['pg/int4@1']['output']");
    expect(result.contractDts).toContain("readonly name: CodecTypes['pg/text@1']['output']");
  });

  it('falls back to CodecTypes when no renderer exists for codecId', async () => {
    const target = createMockTarget();
    const adapter = createMockAdapter();
    // Extension with renderer for pg/vector@1 only
    const extension = createMockExtensionWithParameterizedRenderer(
      'pgvector',
      'pg/vector@1',
      (params) => `Vector<${params['length']}>`,
    );

    const familyInstance = createSqlFamilyInstance({
      target,
      adapter,
      extensionPacks: [extension],
    });

    // Contract with column using a different codecId (no renderer exists)
    const contractIR = createTestContractIR({
      models: {
        Data: {
          storage: { table: 'data' },
          fields: {
            value: { column: 'value' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          data: {
            columns: {
              value: {
                nativeType: 'custom_type',
                codecId: 'custom/type@1',
                nullable: false,
                typeParams: { foo: 'bar' }, // Has typeParams but no renderer
              },
            },
            primaryKey: { columns: [] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const result = await familyInstance.emitContract({ contractIR });

    // Should fall back to standard CodecTypes lookup
    expect(result.contractDts).toContain("readonly value: CodecTypes['custom/type@1']['output']");
  });

  it('collects typesImport from multiple parameterized codecs', async () => {
    // Create multiple parameterized codec configs
    const vectorCodecConfig: ParameterizedCodecConfig = {
      codecId: 'pg/vector@1',
      renderer: 'Vector<{{length}}>',
      typesImport: {
        package: '@prisma-next/extension-pgvector/vector-types',
        named: 'Vector',
        alias: 'PgVector',
      },
    };

    // Create adapter with decimal codec
    const target = createMockTarget();
    const adapter: ControlAdapterDescriptor<'sql', 'postgres'> = {
      ...createMockAdapter(),
      types: {
        codecTypes: {
          import: {
            package: '@prisma-next/adapter-postgres/codec-types',
            named: 'CodecTypes',
            alias: 'PgCodecTypes',
          },
          parameterized: {
            'pg/decimal@1': 'Decimal<{{precision}}, {{scale}}>',
          },
          parameterizedImports: [
            {
              package: '@prisma-next/adapter-postgres/decimal-types',
              named: 'Decimal',
              alias: 'PgDecimal',
            },
          ],
        },
      },
    };
    const extension = createMockExtensionWithParameterizedCodec('pgvector', vectorCodecConfig);

    const familyInstance = createSqlFamilyInstance({
      target,
      adapter,
      extensionPacks: [extension],
    });

    // Create a contract IR with columns using both parameterized codecs
    const contractIR = createTestContractIR({
      models: {
        Data: {
          storage: { table: 'data' },
          fields: {
            id: { column: 'id' },
            vector: { column: 'vector' },
            amount: { column: 'amount' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          data: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              vector: {
                nativeType: 'vector(1536)',
                codecId: 'pg/vector@1',
                nullable: false,
                typeParams: { length: 1536 },
              },
              amount: {
                nativeType: 'numeric(10,2)',
                codecId: 'pg/decimal@1',
                nullable: false,
                typeParams: { precision: 10, scale: 2 },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      extensionPacks: { pgvector: { version: '0.0.1' } },
    });

    const result = await familyInstance.emitContract({ contractIR });

    // Verify both typesImports appear in contract.d.ts
    expect(result.contractDts).toContain(
      "import type { Vector as PgVector } from '@prisma-next/extension-pgvector/vector-types'",
    );
    expect(result.contractDts).toContain(
      "import type { Decimal as PgDecimal } from '@prisma-next/adapter-postgres/decimal-types'",
    );
  });

  it('skips duplicate typesImport from same package', async () => {
    // Two different codecs with imports from the same package
    const target = createMockTarget();
    const adapter = createMockAdapter();
    const extension: ControlExtensionDescriptor<'sql', 'postgres'> = {
      kind: 'extension',
      id: 'pgvector',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
      types: {
        codecTypes: {
          parameterized: {
            'pg/vector@1': 'Vector<{{length}}>',
            'pg/halfvec@1': 'HalfVector<{{length}}>',
          },
          parameterizedImports: [
            {
              package: '@prisma-next/extension-pgvector/vector-types',
              named: 'Vector',
              alias: 'Vector',
            },
            {
              package: '@prisma-next/extension-pgvector/vector-types',
              named: 'HalfVector',
              alias: 'HalfVector',
            },
          ],
        },
      },
    };

    const familyInstance = createSqlFamilyInstance({
      target,
      adapter,
      extensionPacks: [extension],
    });

    // Contract with columns using BOTH parameterized codecs from the same package
    const contractIR = createTestContractIR({
      models: {
        VectorData: {
          storage: { table: 'vector_data' },
          fields: {
            id: { column: 'id' },
            vec: { column: 'vec' },
            halfvec: { column: 'halfvec' },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          vector_data: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              vec: {
                nativeType: 'vector(768)',
                codecId: 'pg/vector@1',
                nullable: false,
                typeParams: { length: 768 },
              },
              halfvec: {
                nativeType: 'halfvec(768)',
                codecId: 'pg/halfvec@1',
                nullable: false,
                typeParams: { length: 768 },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      extensionPacks: { pgvector: { version: '0.0.1' } },
    });

    const result = await familyInstance.emitContract({ contractIR });

    // Both imports should appear (different named exports from the same package)
    // When alias === named, the emitter omits the redundant "as Alias" part
    expect(result.contractDts).toContain(
      "import type { Vector } from '@prisma-next/extension-pgvector/vector-types'",
    );
    expect(result.contractDts).toContain(
      "import type { HalfVector } from '@prisma-next/extension-pgvector/vector-types'",
    );
  });
});
