import type { Contract, ExecutionPlan, ParamDescriptor } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { Codec, Ctx } from '@prisma-next/framework-components/codec';
import type { SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { CodecRegistry, ContractCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  JsonSchemaValidateFn,
  JsonSchemaValidatorRegistry,
} from '@prisma-next/sql-relational-core/query-lane-context';
import { ifDefined } from '@prisma-next/utils/defined';
import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';

// JSON validator factory used by the test extension. The runtime calls this once
// per `storage.types` entry (or per inline-typeParams column) and reads `validate`
// off the resolved codec — replacing the pre-M1 `init` hook on the descriptor.
function makeJsonValidatorFactory(
  codecId: 'pg/json@1' | 'pg/jsonb@1',
  nativeType: 'json' | 'jsonb',
): (params: { readonly schema: Record<string, unknown> }) => (ctx: Ctx) => Codec {
  return (params) => {
    const validate = createStubValidator(params.schema);
    return (_ctx) =>
      ({
        id: codecId,
        targetTypes: [nativeType],
        // The `'json-validator'` trait gates sql-runtime's `extractValidator`
        // — codecs that participate in the JSON-schema validator registry
        // declare it. See ADR 205.
        traits: ['json-validator'] as const,
        decode: (wire: unknown) => wire,
        encodeJson: (v) => v as never,
        decodeJson: (j) => j as never,
        validate,
      }) as Codec & { validate: JsonSchemaValidateFn };
  };
}

// Trivial passthrough factory for test extensions that do not need per-instance
// validator state.
function passthroughFactory(_params: unknown): (ctx: Ctx) => Codec {
  return (_ctx) => ({
    id: 'pg/jsonb@1',
    targetTypes: ['jsonb'],
    decode: (wire: unknown) => wire,
    encodeJson: (v) => v as never,
    decodeJson: (j) => j as never,
  });
}

import { decodeRow } from '../src/codecs/decoding';
import { encodeParam, encodeParams } from '../src/codecs/encoding';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '../src/sql-context';
import { createStubAdapter, createTestContext } from './utils';

// =============================================================================
// Shared test helpers
// =============================================================================

function createStubValidator(schema: Record<string, unknown>): JsonSchemaValidateFn {
  return (value: unknown) => {
    if (schema['type'] === 'object' && typeof value === 'object' && value !== null) {
      const required = (schema['required'] ?? []) as string[];
      const obj = value as Record<string, unknown>;
      for (const prop of required) {
        if (!(prop in obj)) {
          return {
            valid: false,
            errors: [
              {
                path: '/',
                message: `must have required property '${prop}'`,
                keyword: 'required',
              },
            ],
          };
        }
      }
      return { valid: true };
    }
    if (schema['type'] === 'object' && (typeof value !== 'object' || value === null)) {
      return {
        valid: false,
        errors: [{ path: '/', message: 'must be object', keyword: 'type' }],
      };
    }
    return { valid: true };
  };
}

const metadataSchema: Record<string, unknown> = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
};

const userMetadataSchema: Record<string, unknown> = {
  type: 'object',
  properties: { userName: { type: 'string' } },
  required: ['userName'],
};

const postMetadataSchema: Record<string, unknown> = {
  type: 'object',
  properties: { postTitle: { type: 'string' } },
  required: ['postTitle'],
};

function createMetadataValidatorRegistry(): JsonSchemaValidatorRegistry {
  const validators = new Map<string, JsonSchemaValidateFn>();
  validators.set('user.metadata', createStubValidator(metadataSchema));
  return { get: (key) => validators.get(key), size: validators.size };
}

function createJoinMetadataValidatorRegistry(): JsonSchemaValidatorRegistry {
  const validators = new Map<string, JsonSchemaValidateFn>();
  validators.set('user.metadata', createStubValidator(userMetadataSchema));
  validators.set('post.metadata', createStubValidator(postMetadataSchema));
  return { get: (key) => validators.get(key), size: validators.size };
}

function createTestCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  registry.register(
    codec({
      typeId: 'pg/jsonb@1',
      targetTypes: ['jsonb'],
      encode: (v: unknown) => JSON.stringify(v),
      decode: (w: string) => (typeof w === 'string' ? JSON.parse(w) : w),
    }),
  );
  registry.register(
    codec({
      typeId: 'pg/json@1',
      targetTypes: ['json'],
      encode: (v: unknown) => JSON.stringify(v),
      decode: (w: string) => (typeof w === 'string' ? JSON.parse(w) : w),
    }),
  );
  registry.register(
    codec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
  );
  return registry;
}

function createJsonSchemaContract(
  options?: Partial<{
    types: Record<string, StorageTypeInstance>;
    tableColumns: Record<
      string,
      {
        nativeType: string;
        codecId: string;
        nullable: boolean;
        typeParams?: Record<string, unknown>;
        typeRef?: string;
      }
    >;
  }>,
): Contract<SqlStorage> {
  return {
    targetFamily: 'sql',
    target: 'postgres',
    profileHash: profileHash('sha256:test'),
    models: {},
    roots: {},
    storage: {
      storageHash: coreHash('sha256:test'),
      tables: {
        user: {
          columns: options?.tableColumns ?? {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            metadata: {
              nativeType: 'jsonb',
              codecId: 'pg/jsonb@1',
              nullable: true,
              typeParams: { schema: metadataSchema },
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      ...ifDefined('types', options?.types),
    },
    extensionPacks: {},
    capabilities: {},
    meta: {},
  };
}

const jsonTypeParamsSchema = arktype({
  schema: 'object',
  'type?': 'string',
});

function createJsonbExtensionDescriptor(): SqlRuntimeExtensionDescriptor<'postgres'> {
  const parameterizedCodecs: RuntimeParameterizedCodecDescriptor[] = [
    {
      codecId: 'pg/json@1',
      paramsSchema: jsonTypeParamsSchema,
      factory: makeJsonValidatorFactory(
        'pg/json@1',
        'json',
      ) as RuntimeParameterizedCodecDescriptor['factory'],
    },
    {
      codecId: 'pg/jsonb@1',
      paramsSchema: jsonTypeParamsSchema,
      factory: makeJsonValidatorFactory(
        'pg/jsonb@1',
        'jsonb',
      ) as RuntimeParameterizedCodecDescriptor['factory'],
    },
  ];

  const registry = createCodecRegistry();
  registry.register(
    codec({
      typeId: 'pg/json@1',
      targetTypes: ['json'],
      encode: (v: unknown) => JSON.stringify(v),
      decode: (w: string) => (typeof w === 'string' ? JSON.parse(w) : w),
    }),
  );
  registry.register(
    codec({
      typeId: 'pg/jsonb@1',
      targetTypes: ['jsonb'],
      encode: (v: unknown) => JSON.stringify(v),
      decode: (w: string) => (typeof w === 'string' ? JSON.parse(w) : w),
    }),
  );

  return {
    kind: 'extension' as const,
    id: 'json-validation',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => registry,
    parameterizedCodecs: () => parameterizedCodecs,
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createTestPlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    sql: 'SELECT 1',
    params: [],
    meta: {
      target: 'postgres',
      storageHash: 'sha256:test',
      lane: 'dsl',
      paramDescriptors: [],
    },
    ...overrides,
  };
}

// Wraps a `CodecRegistry` as a `ContractCodecRegistry` for tests that only
// exercise codec-id-keyed dispatch (no per-instance state, no `(table,
// column)`-aware lookups). The dispatch interface is unified at Phase 3,
// but the encode-side path of these tests exercises the codec-id fallback,
// not the column-aware lookup.
function asContractCodecRegistry(registry: CodecRegistry): ContractCodecRegistry {
  return {
    forColumn: () => undefined,
    forCodecId: (id) => registry.get(id),
  };
}

// =============================================================================
// Tests: Validator Registry via createExecutionContext
// =============================================================================

describe('JSON Schema validator registry', () => {
  describe('context creation', () => {
    it('builds validator registry for contract with JSON columns that have schemas', () => {
      const contract = createJsonSchemaContract();
      const context = createTestContext(contract, createStubAdapter(), {
        extensionPacks: [createJsonbExtensionDescriptor()],
      });

      expect(context.jsonSchemaValidators).toBeDefined();
      expect(context.jsonSchemaValidators!.size).toBe(1);
      expect(context.jsonSchemaValidators!.get('user.metadata')).toBeDefined();
    });

    it('omits validator registry when no JSON columns have schemas', () => {
      const contract = createJsonSchemaContract({
        tableColumns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
        },
      });
      const context = createTestContext(contract, createStubAdapter(), {
        extensionPacks: [createJsonbExtensionDescriptor()],
      });

      expect(context.jsonSchemaValidators).toBeUndefined();
    });

    it('builds validators for columns with typeRef', () => {
      const contract = createJsonSchemaContract({
        types: {
          ProfileJson: {
            codecId: 'pg/jsonb@1',
            nativeType: 'jsonb',
            typeParams: {
              schema: {
                type: 'object',
                properties: { displayName: { type: 'string' } },
                required: ['displayName'],
              },
            },
          },
        },
        tableColumns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          profile: {
            nativeType: 'jsonb',
            codecId: 'pg/jsonb@1',
            nullable: true,
            typeRef: 'ProfileJson',
          },
        },
      });
      const context = createTestContext(contract, createStubAdapter(), {
        extensionPacks: [createJsonbExtensionDescriptor()],
      });

      expect(context.jsonSchemaValidators).toBeDefined();
      expect(context.jsonSchemaValidators!.get('user.profile')).toBeDefined();
    });

    it('omits validator registry when the resolved codec carries no validate hook', () => {
      const registry = createCodecRegistry();
      registry.register(
        codec({
          typeId: 'pg/jsonb@1',
          targetTypes: ['jsonb'],
          encode: (v: unknown) => JSON.stringify(v),
          decode: (w: string) => (typeof w === 'string' ? JSON.parse(w) : w),
        }),
      );

      const noValidateExtension: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension' as const,
        id: 'json-no-validate',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => registry,
        parameterizedCodecs: () => [
          {
            codecId: 'pg/jsonb@1',
            paramsSchema: jsonTypeParamsSchema,
            factory: passthroughFactory,
          },
        ],
        create() {
          return { familyId: 'sql' as const, targetId: 'postgres' as const };
        },
      };

      const contract = createJsonSchemaContract();
      const context = createTestContext(contract, createStubAdapter(), {
        extensionPacks: [noValidateExtension],
      });

      expect(context.jsonSchemaValidators).toBeUndefined();
    });
  });
});

// =============================================================================
// Tests: Encoding validation
// =============================================================================

describe('JSON Schema encoding validation', () => {
  const codecRegistry = asContractCodecRegistry(createTestCodecRegistry());

  it('encodes JSON values via codec', () => {
    const plan = createTestPlan({
      params: [{ name: 'Alice' }],
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [
          {
            codecId: 'pg/jsonb@1',
            source: 'dsl' as const,
          },
        ],
      },
    });

    const result = encodeParams(plan, codecRegistry);
    expect(result[0]).toBe('{"name":"Alice"}');
  });

  it('returns null for null values', () => {
    const descriptor: ParamDescriptor = {
      codecId: 'pg/jsonb@1',
      source: 'dsl',
    };

    const result = encodeParam(null, descriptor, 0, codecRegistry);
    expect(result).toBeNull();
  });

  it('encodes when descriptor has name', () => {
    const descriptor: ParamDescriptor = {
      name: 'metadata',
      codecId: 'pg/jsonb@1',
      source: 'dsl',
    };

    const result = encodeParam({ age: 30 }, descriptor, 0, codecRegistry);
    expect(result).toBe('{"age":30}');
  });
});

// =============================================================================
// Tests: Decoding validation
// =============================================================================

describe('JSON Schema decoding validation', () => {
  const codecRegistry = asContractCodecRegistry(createTestCodecRegistry());

  it('passes valid decoded JSON values', () => {
    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { metadata: 'pg/jsonb@1' },
        refs: { columns: [{ table: 'user', column: 'metadata' }] },
      },
    });

    const row = { metadata: '{"name":"Alice"}' };
    const result = decodeRow(row, plan, codecRegistry, createMetadataValidatorRegistry());
    expect(result['metadata']).toEqual({ name: 'Alice' });
  });

  it('throws RUNTIME.JSON_SCHEMA_VALIDATION_FAILED for invalid decoded values', () => {
    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { metadata: 'pg/jsonb@1' },
        refs: { columns: [{ table: 'user', column: 'metadata' }] },
      },
    });

    const row = { metadata: '{"age":30}' };
    expect(() => decodeRow(row, plan, codecRegistry, createMetadataValidatorRegistry())).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
        category: 'RUNTIME',
        severity: 'error',
        details: expect.objectContaining({
          table: 'user',
          column: 'metadata',
          direction: 'decode',
          codecId: 'pg/jsonb@1',
        }),
      }),
    );
  });

  it('validates aliased projection columns using projection mapping', () => {
    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projection: { userMeta: 'user.metadata' },
        projectionTypes: { userMeta: 'pg/jsonb@1' },
        refs: { columns: [{ table: 'user', column: 'metadata' }] },
      },
    });

    const row = { userMeta: '{"age":30}' };
    expect(() => decodeRow(row, plan, codecRegistry, createMetadataValidatorRegistry())).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
        details: expect.objectContaining({
          table: 'user',
          column: 'metadata',
          direction: 'decode',
        }),
      }),
    );
  });

  it('resolves join aliases with duplicate column names using projection mapping', () => {
    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projection: {
          userMeta: 'user.metadata',
          postMeta: 'post.metadata',
        },
        projectionTypes: {
          userMeta: 'pg/jsonb@1',
          postMeta: 'pg/jsonb@1',
        },
        refs: {
          columns: [
            { table: 'user', column: 'metadata' },
            { table: 'post', column: 'metadata' },
          ],
        },
      },
    });

    const row = {
      userMeta: '{"userName":"Alice"}',
      postMeta: '{"userName":"Alice"}',
    };
    expect(() =>
      decodeRow(row, plan, codecRegistry, createJoinMetadataValidatorRegistry()),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
        details: expect.objectContaining({
          table: 'post',
          column: 'metadata',
          direction: 'decode',
        }),
      }),
    );
  });

  it('skips validation when column ref cannot be resolved', () => {
    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { data: 'pg/jsonb@1' },
      },
    });

    const row = { data: '{"bad":"data"}' };
    const result = decodeRow(row, plan, codecRegistry, createMetadataValidatorRegistry());
    expect(result['data']).toEqual({ bad: 'data' });
  });

  it('skips validation for null wire values', () => {
    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { metadata: 'pg/jsonb@1' },
        refs: { columns: [{ table: 'user', column: 'metadata' }] },
      },
    });

    const row = { metadata: null };
    const result = decodeRow(row, plan, codecRegistry, createMetadataValidatorRegistry());
    expect(result['metadata']).toBeNull();
  });

  it('skips validation when no registry is provided', () => {
    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { metadata: 'pg/jsonb@1' },
        refs: { columns: [{ table: 'user', column: 'metadata' }] },
      },
    });

    const row = { metadata: '{"bad":"data"}' };
    const result = decodeRow(row, plan, codecRegistry);
    expect(result['metadata']).toEqual({ bad: 'data' });
  });

  it('decodes non-JSON columns without validation', () => {
    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { id: 'pg/int4@1', metadata: 'pg/jsonb@1' },
        refs: {
          columns: [
            { table: 'user', column: 'id' },
            { table: 'user', column: 'metadata' },
          ],
        },
      },
    });

    const row = { id: 42, metadata: '{"name":"Alice"}' };
    const result = decodeRow(row, plan, codecRegistry, createMetadataValidatorRegistry());
    expect(result['id']).toBe(42);
    expect(result['metadata']).toEqual({ name: 'Alice' });
  });
});
