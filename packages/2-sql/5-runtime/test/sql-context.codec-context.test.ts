import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { CodecDescriptor } from '@prisma-next/framework-components/codec';
import { voidParamsSchema } from '@prisma-next/framework-components/codec';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Codec, SqlCodecInstanceContext } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import type { SqlRuntimeExtensionDescriptor } from '../src/sql-context';
import { createStubAdapter, createTestContext } from './utils';

/**
 * `forColumn(table, column)` dispatch must materialize a fresh codec instance with a column-specific `SqlCodecInstanceContext`. The pre-populated `byCodecId` representative is reserved for `forCodecId` refs-less fallbacks; reusing it for column-bound dispatch erases the per-column context any descriptor whose factory reads `CodecInstanceContext` (for diagnostics, telemetry, or per-column behaviour) would expect.
 */
describe('buildContractCodecRegistry — per-column codec instance context', () => {
  function createCtxCapturingExtension(captures: SqlCodecInstanceContext[]): {
    descriptor: SqlRuntimeExtensionDescriptor<'postgres'>;
    instances: Array<{ ctx: SqlCodecInstanceContext; codec: Codec }>;
  } {
    const instances: Array<{ ctx: SqlCodecInstanceContext; codec: Codec }> = [];
    const codecDescriptor: CodecDescriptor<void> = {
      codecId: 'test/captures-ctx@1',
      traits: [],
      targetTypes: ['captures'],
      paramsSchema: voidParamsSchema,
      isParameterized: false,
      // Family-agnostic descriptor slot; SQL-side test consumer reads `usedAt` so the factory parameter is typed as the SQL-extended context. The cast through `unknown` mirrors what production SQL extensions do (see pgvector's family-agnostic factory cast).
      factory: ((_params: undefined) => (ctx: SqlCodecInstanceContext) => {
        captures.push(ctx);
        const codec: Codec = {
          id: 'test/captures-ctx@1',
          encode: (v: unknown) => Promise.resolve(v),
          decode: (w: unknown) => Promise.resolve(w),
          encodeJson: (v) => v as never,
          decodeJson: (j) => j as never,
        };
        instances.push({ ctx, codec });
        return codec;
      }) as unknown as CodecDescriptor<void>['factory'],
    };

    return {
      descriptor: {
        kind: 'extension' as const,
        id: 'test-captures-ctx',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => [codecDescriptor],
        create() {
          return { familyId: 'sql' as const, targetId: 'postgres' as const };
        },
      },
      instances,
    };
  }

  function contractWith(
    columns: Record<string, { codecId: string; nativeType: string }>,
  ): Contract<SqlStorage> {
    const tables: SqlStorage['tables'] = {};
    for (const [tableName, columnSpec] of Object.entries(columns)) {
      tables[tableName] = {
        columns: {
          field: {
            nativeType: columnSpec.nativeType,
            codecId: columnSpec.codecId,
            nullable: false,
          },
        },
        primaryKey: { columns: ['field'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
    }

    return {
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: profileHash('sha256:test'),
      models: {},
      roots: {},
      storage: { storageHash: coreHash('sha256:test'), tables },
      extensionPacks: {},
      capabilities: {},
      meta: {},
    };
  }

  it('materializes a fresh per-column codec instance with `<col:table.column>` context for forColumn dispatch', () => {
    const captures: SqlCodecInstanceContext[] = [];
    const { descriptor, instances } = createCtxCapturingExtension(captures);

    const contract = contractWith({
      users: { codecId: 'test/captures-ctx@1', nativeType: 'captures' },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [descriptor],
    });

    const columnInstance = context.contractCodecs.forColumn('users', 'field');
    expect(columnInstance).toBeDefined();

    const columnCtx = instances.find(({ codec }) => codec === columnInstance)?.ctx;
    expect(columnCtx).toBeDefined();
    expect(columnCtx?.name).toBe('<col:users.field>');
    expect(columnCtx?.usedAt).toEqual([{ table: 'users', column: 'field' }]);
  });

  it('preserves the representative `<shared:codecId>` context for forCodecId fallback', () => {
    const captures: SqlCodecInstanceContext[] = [];
    const { descriptor, instances } = createCtxCapturingExtension(captures);

    // Contract with no column referencing the descriptor — `forCodecId` resolves through the pre-populated representative only.
    const contract = contractWith({});

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [descriptor],
    });

    const codecIdInstance = context.contractCodecs.forCodecId('test/captures-ctx@1');
    expect(codecIdInstance).toBeDefined();

    const sharedCtx = instances.find(({ codec }) => codec === codecIdInstance)?.ctx;
    expect(sharedCtx).toBeDefined();
    expect(sharedCtx?.name).toBe('<shared:test/captures-ctx@1>');
    expect(sharedCtx?.usedAt).toEqual([]);
  });

  it('materializes distinct instances for distinct columns sharing the same codec id', () => {
    const captures: SqlCodecInstanceContext[] = [];
    const { descriptor } = createCtxCapturingExtension(captures);

    const contract = contractWith({
      users: { codecId: 'test/captures-ctx@1', nativeType: 'captures' },
      orders: { codecId: 'test/captures-ctx@1', nativeType: 'captures' },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [descriptor],
    });

    const usersInstance = context.contractCodecs.forColumn('users', 'field');
    const ordersInstance = context.contractCodecs.forColumn('orders', 'field');

    expect(usersInstance).toBeDefined();
    expect(ordersInstance).toBeDefined();
    expect(usersInstance).not.toBe(ordersInstance);

    const usersCtx = captures.find((ctx) => ctx.name === '<col:users.field>');
    const ordersCtx = captures.find((ctx) => ctx.name === '<col:orders.field>');
    expect(usersCtx).toBeDefined();
    expect(ordersCtx).toBeDefined();
    expect(usersCtx?.usedAt).toEqual([{ table: 'users', column: 'field' }]);
    expect(ordersCtx?.usedAt).toEqual([{ table: 'orders', column: 'field' }]);
  });

  it('does not reuse the representative instance for forColumn dispatch', () => {
    const captures: SqlCodecInstanceContext[] = [];
    const { descriptor } = createCtxCapturingExtension(captures);

    const contract = contractWith({
      users: { codecId: 'test/captures-ctx@1', nativeType: 'captures' },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [descriptor],
    });

    const columnInstance = context.contractCodecs.forColumn('users', 'field');
    const codecIdInstance = context.contractCodecs.forCodecId('test/captures-ctx@1');

    // The representative is preserved as the `forCodecId` fallback even after a column resolved through `forColumn` — the two paths must surface distinct instances built with distinct ctxs.
    expect(columnInstance).toBeDefined();
    expect(codecIdInstance).toBeDefined();
    expect(columnInstance).not.toBe(codecIdInstance);
  });
});

/**
 * `forCodecRef` is the AST-bound dispatch surface: every codec-bearing AST node carries a {@link CodecRef} and the runtime resolves through this method via the per-`ExecutionContext` `AstCodecResolver`. M2 pre-populates the resolver's cache from the contract walk; M3 will collapse `forColumn`/`forCodecId` onto this single dispatch path.
 */
describe('buildContractCodecRegistry — forCodecRef content-keyed cache', () => {
  function createCountingVectorExtension(): {
    descriptor: SqlRuntimeExtensionDescriptor<'postgres'>;
    factoryCalls: () => number;
  } {
    let factoryCalls = 0;
    const codecDescriptor: CodecDescriptor<{ length: number }> = {
      codecId: 'pgvector/vector@1',
      traits: ['equality'],
      targetTypes: ['vector'],
      paramsSchema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value) => ({ value: value as { length: number } }),
        },
      },
      isParameterized: true,
      factory: ((params: { length: number }) => (ctx: SqlCodecInstanceContext) => {
        factoryCalls += 1;
        const codec: Codec = {
          id: 'pgvector/vector@1',
          encode: (v: unknown) => Promise.resolve(v),
          decode: (w: unknown) => Promise.resolve(w),
          encodeJson: (v) => v as never,
          decodeJson: (j) => j as never,
        };
        return Object.assign({}, codec, {
          meta: { length: params.length, ctxName: ctx.name },
        }) as Codec;
      }) as unknown as CodecDescriptor<{ length: number }>['factory'],
    };

    return {
      descriptor: {
        kind: 'extension' as const,
        id: 'pgvector-test',
        version: '0.0.1',
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        codecs: () => [codecDescriptor as unknown as CodecDescriptor],
        create() {
          return { familyId: 'sql' as const, targetId: 'postgres' as const };
        },
      },
      factoryCalls: () => factoryCalls,
    };
  }

  function contractWithVector(
    columns: Record<string, { typeRef?: string; typeParams?: { length: number } }>,
    types?: Record<string, { length: number }>,
  ): Contract<SqlStorage> {
    const tables: SqlStorage['tables'] = {};
    for (const [tableName, spec] of Object.entries(columns)) {
      tables[tableName] = {
        columns: {
          embedding: {
            nativeType: 'vector',
            codecId: 'pgvector/vector@1',
            nullable: false,
            ...(spec.typeRef ? { typeRef: spec.typeRef } : {}),
            ...(spec.typeParams ? { typeParams: spec.typeParams } : {}),
          },
        },
        primaryKey: { columns: ['embedding'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
    }

    const storage: SqlStorage = {
      storageHash: coreHash('sha256:test'),
      tables,
      ...(types
        ? {
            types: Object.fromEntries(
              Object.entries(types).map(([name, params]) => [
                name,
                {
                  codecId: 'pgvector/vector@1',
                  nativeType: 'vector',
                  typeParams: params as Record<string, unknown>,
                },
              ]),
            ),
          }
        : {}),
    };

    return {
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: profileHash('sha256:test'),
      models: {},
      roots: {},
      storage,
      extensionPacks: {},
      capabilities: {},
      meta: {},
    };
  }

  it('returns the same codec instance for two refs with the same `(codecId, typeParams)`', () => {
    const { descriptor } = createCountingVectorExtension();
    const contract = contractWithVector({ Doc: { typeParams: { length: 1536 } } });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [descriptor],
    });

    const a = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 1536 },
    });
    const b = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 1536 },
    });

    expect(a).toBe(b);
  });

  it('keys cache by canonicalised typeParams so object key order does not matter', () => {
    const { descriptor } = createCountingVectorExtension();
    const contract = contractWithVector({
      Doc: { typeParams: { length: 768 } as { length: number } },
    });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [descriptor],
    });

    const a = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 1024, normalized: true } as never,
    });
    const b = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { normalized: true, length: 1024 } as never,
    });

    expect(a).toBe(b);
  });

  it('pre-populates the cache from the contract walk so contract-declared refs hit on first call', () => {
    const { descriptor, factoryCalls } = createCountingVectorExtension();
    const contract = contractWithVector({ Doc: { typeParams: { length: 1536 } } });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [descriptor],
    });

    const callsAfterContextConstruction = factoryCalls();
    expect(callsAfterContextConstruction).toBeGreaterThan(0);

    const codec = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 1536 },
    });

    expect(codec).toBeDefined();
    expect(factoryCalls()).toBe(callsAfterContextConstruction);
  });

  it('lazy-materialises a codec when the AST supplies a ref the contract walk did not declare', () => {
    const { descriptor, factoryCalls } = createCountingVectorExtension();
    const contract = contractWithVector({ Doc: { typeParams: { length: 1536 } } });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [descriptor],
    });

    const before = factoryCalls();
    const codec = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 2048 },
    });

    expect(codec).toBeDefined();
    expect(factoryCalls()).toBe(before + 1);
  });

  it('typeRef-shared columns resolve through forCodecRef to the same named-instance codec', () => {
    const { descriptor } = createCountingVectorExtension();
    const contract = contractWithVector(
      { Doc: { typeRef: 'V1536' }, Page: { typeRef: 'V1536' } },
      { V1536: { length: 1536 } },
    );

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [descriptor],
    });

    const codec = context.contractCodecs.forCodecRef({
      codecId: 'pgvector/vector@1',
      typeParams: { length: 1536 },
    });

    expect(codec).toBeDefined();
    // Pre-population uses the typeRef ctx — the cached codec's meta.ctxName carries the `storage.types` name.
    expect((codec as Codec & { meta: { ctxName: string } }).meta.ctxName).toBe('V1536');
  });

  it('throws RUNTIME.CODEC_DESCRIPTOR_MISSING when the codecId is unknown to the resolver', () => {
    const { descriptor } = createCountingVectorExtension();
    const contract = contractWithVector({ Doc: { typeParams: { length: 1536 } } });

    const context = createTestContext(contract, createStubAdapter(), {
      extensionPacks: [descriptor],
    });

    expect(() => context.contractCodecs.forCodecRef({ codecId: 'nope/missing@1' })).toThrow(
      /CODEC_DESCRIPTOR_MISSING|nope\/missing@1/,
    );
  });
});
