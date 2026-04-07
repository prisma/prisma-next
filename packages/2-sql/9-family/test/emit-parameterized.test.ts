import { createSqlContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import type { EmitResult, EmitStackInput } from '@prisma-next/emitter';
import { emit } from '@prisma-next/emitter';
import type {
  FamilyDescriptor,
  TargetDescriptor,
} from '@prisma-next/framework-components/components';
import {
  extractCodecTypeImports,
  extractComponentIds,
  extractOperationTypeImports,
  extractParameterizedRenderers,
  extractParameterizedTypeImports,
  extractQueryOperationTypeImports,
} from '@prisma-next/framework-components/control';
import type {
  TypeRenderEntry,
  TypeRenderer,
  TypesImportSpec,
} from '@prisma-next/framework-components/emission';
import { createOperationRegistry } from '@prisma-next/operations';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';
import type { SqlControlDescriptorWithContributions } from '../src/core/assembly';
import type {
  SqlControlAdapterDescriptor,
  SqlControlExtensionDescriptor,
} from '../src/core/migrations/types';

interface EmitTestDescriptors {
  readonly family: FamilyDescriptor<'sql'>;
  readonly target: TargetDescriptor<'sql', 'postgres'> & SqlControlDescriptorWithContributions;
  readonly adapter: SqlControlAdapterDescriptor<'postgres'>;
  readonly extensionPacks: readonly SqlControlExtensionDescriptor<'postgres'>[];
}

function createMockFamily(): FamilyDescriptor<'sql'> {
  return {
    kind: 'family',
    id: 'sql',
    version: '0.0.1',
    familyId: 'sql',
  };
}

async function emitWithDescriptors(
  contract: Contract,
  descriptors: EmitTestDescriptors,
): Promise<EmitResult> {
  const allDescs = [
    descriptors.family,
    descriptors.target,
    descriptors.adapter,
    ...descriptors.extensionPacks,
  ];
  const operationRegistry = createOperationRegistry();
  for (const desc of allDescs) {
    for (const sig of desc.operationSignatures?.() ?? []) {
      operationRegistry.register(sig);
    }
  }
  const stackInput: EmitStackInput = {
    codecTypeImports: extractCodecTypeImports(allDescs),
    operationTypeImports: extractOperationTypeImports(allDescs),
    queryOperationTypeImports: extractQueryOperationTypeImports(allDescs),
    extensionIds: extractComponentIds(
      descriptors.family,
      descriptors.target,
      descriptors.adapter,
      descriptors.extensionPacks,
    ),
    parameterizedRenderers: extractParameterizedRenderers(allDescs),
    parameterizedTypeImports: extractParameterizedTypeImports(allDescs),
    operationRegistry,
  };
  return emit(contract, stackInput, sqlTargetFamilyHook);
}

/**
 * Integration tests for parameterized codec emission plumbing.
 *
 * These tests verify that parameterized renderers flow correctly
 * from family instance creation through to contract emission.
 *
 * Key architecture notes:
 * - Parameterized type renderers are defined in `types.codecTypes.parameterized`
 * - Renderers are normalized to `TypeRenderEntry` by the assembly layer
 * - Type imports for parameterized types are defined in `types.codecTypes.typeImports`
 */

function createMockTarget(): TargetDescriptor<'sql', 'postgres'> &
  SqlControlDescriptorWithContributions {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    operationSignatures: () => [],
    types: {},
  };
}

function createMockAdapter(): SqlControlAdapterDescriptor<'postgres'> {
  return {
    kind: 'adapter',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    operationSignatures: () => [],
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
): SqlControlExtensionDescriptor<'postgres'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    operationSignatures: () => [],
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    types: {
      codecTypes: {
        parameterized: {
          [config.codecId]: config.renderer,
        },
        ...ifDefined('typeImports', config.typesImport ? [config.typesImport] : undefined),
      },
    },
  };
}

function createMockExtensionWithParameterizedRenderer(
  id: string,
  codecId: string,
  renderer: TypeRenderEntry['render'],
): SqlControlExtensionDescriptor<'postgres'> {
  return {
    kind: 'extension',
    id,
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    operationSignatures: () => [],
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

function createTestContract(overrides: Record<string, unknown> = {}): Contract {
  return createSqlContract(overrides);
}

describe('emit parameterized codecs integration', () => {
  it('emits typeParams on model field with parameterized codec', async () => {
    // Create an extension with a parameterized renderer
    const target = createMockTarget();
    const adapter = createMockAdapter();
    const extension = createMockExtensionWithParameterizedRenderer(
      'pgvector',
      'pg/vector@1',
      (params) => `Vector<${params['length']}>`,
    );

    // Create a contract IR with a column using the parameterized codec
    const contract = createTestContract({
      models: {
        Embedding: {
          storage: {
            table: 'embedding',
            fields: {
              id: { column: 'id' },
              vector: { column: 'vector' },
            },
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

    const result = await emitWithDescriptors(contract, {
      family: createMockFamily(),
      target,
      adapter,
      extensionPacks: [extension],
    });

    expect(result.contractDts).toMatch(
      /readonly vector:\s*\{[\s\S]*?readonly codecId: 'pg\/vector@1';[\s\S]*?readonly typeParams: \{ readonly length: 1536 \}/,
    );

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

    // Create a contract IR with a column using the parameterized codec
    const contract = createTestContract({
      models: {
        Embedding: {
          storage: {
            table: 'embedding',
            fields: {
              id: { column: 'id' },
              vector: { column: 'vector' },
            },
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

    const result = await emitWithDescriptors(contract, {
      family: createMockFamily(),
      target,
      adapter,
      extensionPacks: [extension],
    });

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

    // Contract with columns WITHOUT typeParams
    const contract = createTestContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
              name: { column: 'name' },
            },
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

    const result = await emitWithDescriptors(contract, {
      family: createMockFamily(),
      target,
      adapter,
      extensionPacks: [extension],
    });

    // Standard columns should use ContractField format
    expect(result.contractDts).toContain(
      "readonly id: { readonly codecId: 'pg/int4@1'; readonly nullable: false }",
    );
    expect(result.contractDts).toContain(
      "readonly name: { readonly codecId: 'pg/text@1'; readonly nullable: false }",
    );
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

    // Contract with column using a different codecId (no renderer exists)
    const contract = createTestContract({
      models: {
        Data: {
          storage: {
            table: 'data',
            fields: {
              value: { column: 'value' },
            },
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

    const result = await emitWithDescriptors(contract, {
      family: createMockFamily(),
      target,
      adapter,
      extensionPacks: [extension],
    });

    expect(result.contractDts).toMatch(
      /readonly value:\s*\{[\s\S]*?readonly codecId: 'custom\/type@1';[\s\S]*?readonly typeParams: \{ readonly foo: 'bar' \}/,
    );
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
    const adapter: SqlControlAdapterDescriptor<'postgres'> = {
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
          typeImports: [
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

    // Create a contract IR with columns using both parameterized codecs
    const contract = createTestContract({
      models: {
        Data: {
          storage: {
            table: 'data',
            fields: {
              id: { column: 'id' },
              vector: { column: 'vector' },
              amount: { column: 'amount' },
            },
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

    const result = await emitWithDescriptors(contract, {
      family: createMockFamily(),
      target,
      adapter,
      extensionPacks: [extension],
    });

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
    const extension: SqlControlExtensionDescriptor<'postgres'> = {
      kind: 'extension',
      id: 'pgvector',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      operationSignatures: () => [],
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
      types: {
        codecTypes: {
          parameterized: {
            'pg/vector@1': 'Vector<{{length}}>',
            'pg/halfvec@1': 'HalfVector<{{length}}>',
          },
          typeImports: [
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

    // Contract with columns using BOTH parameterized codecs from the same package
    const contract = createTestContract({
      models: {
        VectorData: {
          storage: {
            table: 'vector_data',
            fields: {
              id: { column: 'id' },
              vec: { column: 'vec' },
              halfvec: { column: 'halfvec' },
            },
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

    const result = await emitWithDescriptors(contract, {
      family: createMockFamily(),
      target,
      adapter,
      extensionPacks: [extension],
    });

    // Both imports should appear (different named exports from the same package)
    // When alias === named, the emitter omits the redundant "as Alias" part
    expect(result.contractDts).toContain(
      "import type { Vector } from '@prisma-next/extension-pgvector/vector-types'",
    );
    expect(result.contractDts).toContain(
      "import type { HalfVector } from '@prisma-next/extension-pgvector/vector-types'",
    );
  });

  it('emits typeParams on jsonb column and omits typeParams on unparameterized column', async () => {
    const target = createMockTarget();
    const adapter: SqlControlAdapterDescriptor<'postgres'> = {
      ...createMockAdapter(),
      types: {
        codecTypes: {
          import: {
            package: '@prisma-next/adapter-postgres/codec-types',
            named: 'CodecTypes',
            alias: 'PgCodecTypes',
          },
          parameterized: {
            'pg/jsonb@1': {
              kind: 'function',
              render: (params: Record<string, unknown>) => {
                const typeName = params['type'];
                return typeof typeName === 'string' && typeName.length > 0 ? typeName : 'JsonValue';
              },
            },
          },
          typeImports: [
            {
              package: '@prisma-next/adapter-postgres/codec-types',
              named: 'JsonValue',
              alias: 'JsonValue',
            },
          ],
        },
      },
    };

    const contract = createTestContract({
      models: {
        Event: {
          storage: {
            table: 'event',
            fields: {
              payload: { column: 'payload' },
              metadata: { column: 'metadata' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          event: {
            columns: {
              payload: {
                nativeType: 'jsonb',
                codecId: 'pg/jsonb@1',
                nullable: false,
                typeParams: { type: 'AuditPayload' },
              },
              metadata: {
                nativeType: 'jsonb',
                codecId: 'pg/jsonb@1',
                nullable: false,
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

    const result = await emitWithDescriptors(contract, {
      family: createMockFamily(),
      target,
      adapter,
      extensionPacks: [],
    });

    expect(result.contractDts).toMatch(
      /readonly payload:\s*\{[\s\S]*?readonly codecId: 'pg\/jsonb@1';[\s\S]*?readonly typeParams: \{ readonly type: 'AuditPayload' \}/,
    );
    expect(result.contractDts).toContain(
      "readonly metadata: { readonly codecId: 'pg/jsonb@1'; readonly nullable: false }",
    );
  });
});

describe('E2E: jsonb(schema) renderer dispatch', () => {
  // TML-2204: once renderer dispatch is implemented, remove `.fails` — the
  // emitter should call the renderer and produce `AuditPayload` as a rendered
  // type expression instead of structural `typeParams` data.
  it.fails('renders jsonb column via parameterized renderer (TML-2204)', async () => {
    const target = createMockTarget();
    const adapter: SqlControlAdapterDescriptor<'postgres'> = {
      ...createMockAdapter(),
      types: {
        codecTypes: {
          import: {
            package: '@prisma-next/adapter-postgres/codec-types',
            named: 'CodecTypes',
            alias: 'PgCodecTypes',
          },
          parameterized: {
            'pg/jsonb@1': {
              kind: 'function',
              render: (params: Record<string, unknown>) => {
                const typeName = params['type'];
                return typeof typeName === 'string' && typeName.length > 0 ? typeName : 'JsonValue';
              },
            },
          },
          typeImports: [
            {
              package: '@prisma-next/adapter-postgres/codec-types',
              named: 'JsonValue',
              alias: 'JsonValue',
            },
          ],
        },
      },
    };

    const contract = createTestContract({
      models: {
        Event: {
          storage: {
            table: 'event',
            fields: {
              payload: { column: 'payload' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          event: {
            columns: {
              payload: {
                nativeType: 'jsonb',
                codecId: 'pg/jsonb@1',
                nullable: false,
                typeParams: { type: 'AuditPayload' },
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

    const result = await emitWithDescriptors(contract, {
      family: createMockFamily(),
      target,
      adapter,
      extensionPacks: [],
    });

    expect(result.contractDts).toMatch(/readonly payload:\s*AuditPayload\b/);
  });
});

describe('E2E: PSL named types → interpret → emit', () => {
  it('resolves typeRef to inline typeParams on model fields from PSL named types', async () => {
    const document = parsePslDocument({
      schema: `types {
  Embedding1536 = Bytes @pgvector.column(length: 1536)
}

model Document {
  id Int @id
  embedding Embedding1536
}
`,
      sourceId: 'schema.prisma',
    });

    const interpretResult = interpretPslDocumentToSqlContract({
      document,
      target: {
        kind: 'target',
        familyId: 'sql',
        targetId: 'postgres',
        id: 'postgres',
        version: '0.0.1',
        capabilities: {},
      },
      scalarTypeDescriptors: new Map([
        ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
        ['Bytes', { codecId: 'pg/bytea@1', nativeType: 'bytea' }],
      ]),
      composedExtensionPacks: ['pgvector'],
    });

    expect(interpretResult.ok).toBe(true);
    if (!interpretResult.ok) return;

    const contract = interpretResult.value;

    const result = await emitWithDescriptors(contract, {
      family: createMockFamily(),
      target: createMockTarget(),
      adapter: createMockAdapter(),
      extensionPacks: [
        createMockExtensionWithParameterizedRenderer(
          'pgvector',
          'pg/vector@1',
          (params) => `Vector<${params['length']}>`,
        ),
      ],
    });

    expect(result.contractDts).toMatch(
      /readonly fields:\s*\{[\s\S]*?readonly embedding:\s*\{[\s\S]*?readonly typeParams: \{ readonly length: 1536 \}/,
    );
    expect(result.contractDts).toContain("readonly typeRef: 'Embedding1536'");
    expect(result.contractDts).not.toMatch(
      /readonly fields:\s*\{[\s\S]*?readonly embedding:\s*\{[\s\S]*?readonly typeRef:/,
    );
  });
});
