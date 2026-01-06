import type { ParameterizedCodecDescriptor } from '@prisma-next/contract/types';
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
 * These tests verify that parameterized codec descriptors flow correctly
 * from family instance creation through to contract emission.
 */

function createMockTarget(): ControlTargetDescriptor<'sql', 'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
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

function createMockExtensionWithParameterizedCodec(
  id: string,
  parameterizedCodec: ParameterizedCodecDescriptor,
): ControlExtensionDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    types: {
      parameterizedCodecs: [parameterizedCodec],
    },
  };
}

describe('emit parameterized codecs integration', () => {
  it('emits typesImport from parameterizedCodecs in contract.d.ts', async () => {
    // Create a parameterized codec descriptor with typesImport
    const vectorCodec: ParameterizedCodecDescriptor = {
      codecId: 'pg/vector@1',
      outputTypeRenderer: 'Vector<{{length}}>',
      typesImport: {
        package: '@prisma-next/extension-pgvector/vector-types',
        named: 'Vector',
        alias: 'PgVector',
      },
    };

    // Create family instance with the extension
    const target = createMockTarget();
    const adapter = createMockAdapter();
    const extension = createMockExtensionWithParameterizedCodec('pgvector', vectorCodec);

    const familyInstance = createSqlFamilyInstance({
      target,
      adapter,
      extensionPacks: [extension],
    });

    // Create a contract IR with a column using the parameterized codec
    const contractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      coreHash: 'sha256:placeholder',
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
      relations: {},
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
      capabilities: {},
      meta: {},
      sources: {},
    };

    // Emit the contract
    const result = await familyInstance.emitContract({ contractIR });

    // Verify the parameterized codec's typesImport appears in contract.d.ts
    expect(result.contractDts).toContain(
      "import type { Vector as PgVector } from '@prisma-next/extension-pgvector/vector-types'",
    );
  });

  it('collects typesImport from multiple parameterized codecs', async () => {
    // Create multiple parameterized codec descriptors
    const vectorCodec: ParameterizedCodecDescriptor = {
      codecId: 'pg/vector@1',
      outputTypeRenderer: 'Vector<{{length}}>',
      typesImport: {
        package: '@prisma-next/extension-pgvector/vector-types',
        named: 'Vector',
        alias: 'PgVector',
      },
    };
    const decimalCodec: ParameterizedCodecDescriptor = {
      codecId: 'pg/decimal@1',
      outputTypeRenderer: 'Decimal<{{precision}}, {{scale}}>',
      typesImport: {
        package: '@prisma-next/adapter-postgres/decimal-types',
        named: 'Decimal',
        alias: 'PgDecimal',
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
        },
        parameterizedCodecs: [decimalCodec],
      },
    };
    const extension = createMockExtensionWithParameterizedCodec('pgvector', vectorCodec);

    const familyInstance = createSqlFamilyInstance({
      target,
      adapter,
      extensionPacks: [extension],
    });

    // Create a contract IR with columns using both parameterized codecs
    const contractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      coreHash: 'sha256:placeholder',
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
      relations: {},
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
      capabilities: {},
      meta: {},
      sources: {},
    };

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
    // Same typesImport from two different codecs should only appear once
    const vectorCodec1: ParameterizedCodecDescriptor = {
      codecId: 'pg/vector@1',
      outputTypeRenderer: 'Vector<{{length}}>',
      typesImport: {
        package: '@prisma-next/extension-pgvector/vector-types',
        named: 'Vector',
        alias: 'Vector',
      },
    };
    const vectorCodec2: ParameterizedCodecDescriptor = {
      codecId: 'pg/halfvec@1',
      outputTypeRenderer: 'HalfVector<{{length}}>',
      typesImport: {
        package: '@prisma-next/extension-pgvector/vector-types',
        named: 'HalfVector',
        alias: 'HalfVector',
      },
    };

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
        parameterizedCodecs: [vectorCodec1, vectorCodec2],
      },
    };

    const familyInstance = createSqlFamilyInstance({
      target,
      adapter,
      extensionPacks: [extension],
    });

    // Contract with columns using BOTH parameterized codecs from the same package
    const contractIR = {
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      coreHash: 'sha256:placeholder',
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
      relations: {},
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
      capabilities: {},
      meta: {},
      sources: {},
    };

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
