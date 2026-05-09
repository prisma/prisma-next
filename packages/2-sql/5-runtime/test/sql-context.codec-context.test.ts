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
 * F42 — `forColumn(table, column)` dispatch must materialize a fresh
 * codec instance with a column-specific `SqlCodecInstanceContext`. The
 * pre-populated `byCodecId` representative is reserved for `forCodecId`
 * refs-less fallbacks; reusing it for column-bound dispatch erases the
 * per-column context any descriptor whose factory reads
 * `CodecInstanceContext` (for diagnostics, telemetry, or per-column
 * behaviour) would expect.
 */
describe('buildContractCodecRegistry — per-column codec instance context (F42)', () => {
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
      // Family-agnostic descriptor slot; SQL-side test consumer reads
      // `usedAt` so the factory parameter is typed as the SQL-extended
      // context. The cast through `unknown` mirrors what production SQL
      // extensions do (see pgvector's family-agnostic factory cast).
      factory: ((_params: void) => (ctx: SqlCodecInstanceContext) => {
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

    // Contract with no column referencing the descriptor — `forCodecId`
    // resolves through the pre-populated representative only.
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

    // The representative is preserved as the `forCodecId` fallback even
    // after a column resolved through `forColumn` — the two paths must
    // surface distinct instances built with distinct ctxs.
    expect(columnInstance).toBeDefined();
    expect(codecIdInstance).toBeDefined();
    expect(columnInstance).not.toBe(codecIdInstance);
  });
});
