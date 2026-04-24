import type { Contract, ExecutionPlan, ParamDescriptor } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  JsonSchemaValidateFn,
  JsonSchemaValidatorRegistry,
} from '@prisma-next/sql-relational-core/query-lane-context';
import { ifDefined } from '@prisma-next/utils/defined';
import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import { decodeRow } from '../src/codecs/decoding';
import {
  encodeParam,
  encodeParams,
  encodeParamsAsync,
  hasAsyncParamEncoding,
} from '../src/codecs/encoding';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '../src/sql-context';
import { createAsyncSecretCodec, encryptSecret } from './seeded-secret-codec';
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

const asyncSecretSeed = 'json-schema-validation-secret';

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

function createAsyncCodecRegistry(): CodecRegistry {
  const registry = createTestCodecRegistry();
  registry.register(createAsyncSecretCodec({ seed: asyncSecretSeed }));
  registry.register(
    codec({
      typeId: 'pg/async-jsonb@1',
      targetTypes: ['jsonb'],
      runtime: { decode: 'async' } as const,
      encode: (value: unknown) => JSON.stringify(value),
      decode: async (wire: string) => (typeof wire === 'string' ? JSON.parse(wire) : wire),
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
      init: (params: Record<string, unknown>) => ({
        validate: createStubValidator(params['schema'] as Record<string, unknown>),
      }),
    },
    {
      codecId: 'pg/jsonb@1',
      paramsSchema: jsonTypeParamsSchema,
      init: (params: Record<string, unknown>) => ({
        validate: createStubValidator(params['schema'] as Record<string, unknown>),
      }),
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

    it('omits validator registry when no init hooks are defined', () => {
      const registry = createCodecRegistry();
      registry.register(
        codec({
          typeId: 'pg/jsonb@1',
          targetTypes: ['jsonb'],
          encode: (v: unknown) => JSON.stringify(v),
          decode: (w: string) => (typeof w === 'string' ? JSON.parse(w) : w),
        }),
      );

      const noInitExtension: SqlRuntimeExtensionDescriptor<'postgres'> = {
        kind: 'extension' as const,
        id: 'json-no-init',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => registry,
        parameterizedCodecs: () => [{ codecId: 'pg/jsonb@1', paramsSchema: jsonTypeParamsSchema }],
        create() {
          return { familyId: 'sql' as const, targetId: 'postgres' as const };
        },
      };

      const contract = createJsonSchemaContract();
      const context = createTestContext(contract, createStubAdapter(), {
        extensionPacks: [noInitExtension],
      });

      expect(context.jsonSchemaValidators).toBeUndefined();
    });
  });
});

// =============================================================================
// Tests: Encoding validation
// =============================================================================

describe('JSON Schema encoding validation', () => {
  const codecRegistry = createTestCodecRegistry();

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

  it('detects when a plan needs async parameter encoding', () => {
    const codecRegistry = createAsyncCodecRegistry();
    const plan = createTestPlan({
      params: ['Alice'],
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [
          {
            name: 'secret',
            codecId: 'pg/secret@1',
            source: 'dsl' as const,
          },
        ],
      },
    });

    expect(hasAsyncParamEncoding(plan, codecRegistry)).toBe(true);
  });

  it('awaits async codec parameter encoding on the async path', async () => {
    const codecRegistry = createAsyncCodecRegistry();
    const plan = createTestPlan({
      params: ['Alice'],
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [
          {
            name: 'secret',
            codecId: 'pg/secret@1',
            source: 'dsl' as const,
          },
        ],
      },
    });

    const result = await encodeParamsAsync(plan, codecRegistry);
    expect(result[0]).toBe(await encryptSecret('Alice', asyncSecretSeed));
  });
});

// =============================================================================
// Tests: Decoding validation
// =============================================================================

describe('JSON Schema decoding validation', () => {
  const codecRegistry = createTestCodecRegistry();

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

  it('returns mixed rows with plain sync fields and promise-valued async decode fields', async () => {
    const codecRegistry = createAsyncCodecRegistry();
    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: {
          id: 'pg/int4@1',
          secret: 'pg/secret@1',
        },
        refs: {
          columns: [
            { table: 'user', column: 'id' },
            { table: 'user', column: 'secret' },
          ],
        },
      },
    });

    const row = { id: 7, secret: await encryptSecret('Alice', asyncSecretSeed) };
    const result = decodeRow(row, plan, codecRegistry);

    expect(result['id']).toBe(7);
    expect(result['secret']).toBeInstanceOf(Promise);
    await expect(result['secret'] as Promise<unknown>).resolves.toBe('Alice');
  });

  it('wraps async decode failures with runtime context', async () => {
    const codecRegistry = createAsyncCodecRegistry();
    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { secret: 'pg/secret@1' },
        refs: { columns: [{ table: 'user', column: 'secret' }] },
      },
    });

    const row = { secret: 'bad-payload' };
    const result = decodeRow(row, plan, codecRegistry);

    await expect(result['secret'] as Promise<unknown>).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      details: expect.objectContaining({
        alias: 'secret',
        codec: 'pg/secret@1',
      }),
    });
  });

  it('preserves JSON schema validation for async decoded values', async () => {
    const codecRegistry = createAsyncCodecRegistry();
    const plan = createTestPlan({
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [],
        projectionTypes: { metadata: 'pg/async-jsonb@1' },
        refs: { columns: [{ table: 'user', column: 'metadata' }] },
      },
    });

    const row = { metadata: '{"age":30}' };
    const result = decodeRow(row, plan, codecRegistry, createMetadataValidatorRegistry());

    await expect(result['metadata'] as Promise<unknown>).rejects.toMatchObject({
      code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
      details: expect.objectContaining({
        table: 'user',
        column: 'metadata',
        direction: 'decode',
        codecId: 'pg/async-jsonb@1',
      }),
    });
  });
});
