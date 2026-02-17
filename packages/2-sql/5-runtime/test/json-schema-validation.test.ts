import type { ExecutionPlan, ParamDescriptor } from '@prisma-next/contract/types';
import { coreHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
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

function createMetadataValidatorRegistry(): JsonSchemaValidatorRegistry {
  const validators = new Map<string, JsonSchemaValidateFn>();
  validators.set('user.metadata', createStubValidator(metadataSchema));
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
): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    storageHash: coreHash('sha256:test'),
    models: {},
    relations: {},
    storage: {
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
    sources: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    },
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
    operationSignatures: () => [],
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
        operationSignatures: () => [],
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

  it('passes valid JSON values', () => {
    const plan = createTestPlan({
      params: [{ name: 'Alice' }],
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [
          {
            index: 0,
            codecId: 'pg/jsonb@1',
            source: 'dsl' as const,
            refs: { table: 'user', column: 'metadata' },
          },
        ],
      },
    });

    const result = encodeParams(plan, codecRegistry, createMetadataValidatorRegistry());
    expect(result[0]).toBe('{"name":"Alice"}');
  });

  it('throws RUNTIME.JSON_SCHEMA_VALIDATION_FAILED for invalid JSON values', () => {
    const descriptor: ParamDescriptor = {
      index: 0,
      codecId: 'pg/jsonb@1',
      source: 'dsl',
      refs: { table: 'user', column: 'metadata' },
    };

    const plan = createTestPlan({
      params: [{ age: 30 }],
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [descriptor],
      },
    });

    expect(() =>
      encodeParam({ age: 30 }, descriptor, plan, codecRegistry, createMetadataValidatorRegistry()),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
        category: 'RUNTIME',
        severity: 'error',
        details: expect.objectContaining({
          table: 'user',
          column: 'metadata',
          direction: 'encode',
          codecId: 'pg/jsonb@1',
        }),
      }),
    );
  });

  it('skips validation for params without refs', () => {
    const descriptor: ParamDescriptor = {
      index: 0,
      codecId: 'pg/jsonb@1',
      source: 'dsl',
    };

    const plan = createTestPlan({
      params: [{ invalid: true }],
      meta: {
        target: 'postgres',
        storageHash: 'sha256:test',
        lane: 'dsl',
        paramDescriptors: [descriptor],
      },
    });

    const result = encodeParam(
      { invalid: true },
      descriptor,
      plan,
      codecRegistry,
      createMetadataValidatorRegistry(),
    );
    expect(result).toBe('{"invalid":true}');
  });

  it('skips validation for null values', () => {
    const descriptor: ParamDescriptor = {
      index: 0,
      codecId: 'pg/jsonb@1',
      source: 'dsl',
      refs: { table: 'user', column: 'metadata' },
    };

    const plan = createTestPlan();
    const result = encodeParam(
      null,
      descriptor,
      plan,
      codecRegistry,
      createMetadataValidatorRegistry(),
    );
    expect(result).toBeNull();
  });

  it('skips validation when no registry is provided', () => {
    const descriptor: ParamDescriptor = {
      index: 0,
      codecId: 'pg/jsonb@1',
      source: 'dsl',
      refs: { table: 'user', column: 'metadata' },
    };

    const plan = createTestPlan();
    const result = encodeParam({ age: 30 }, descriptor, plan, codecRegistry);
    expect(result).toBe('{"age":30}');
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
