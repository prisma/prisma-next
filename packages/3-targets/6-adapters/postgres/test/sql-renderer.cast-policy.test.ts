import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import type { RuntimeExtensionDescriptor } from '@prisma-next/framework-components/execution';
import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  BinaryExpr,
  ColumnRef,
  codec,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';
import { createComposedPostgresAdapter } from './helpers/composed-adapter';

const baseContract = validateContract<PostgresContract>(
  {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: 'sha256:cast-policy-test',
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    storage: {
      storageHash: 'sha256:cast-policy',
      tables: {
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            tag: { codecId: 'app/test-foo@1', nativeType: 'foo', nullable: false },
            score: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            note: { codecId: 'pg/enum@1', nativeType: 'tag', nullable: false },
            geo: { codecId: 'app/geography@1', nativeType: 'geography', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
  },
  { get: () => undefined },
);

function selectWithParam(column: string, codecId: string | undefined, value: unknown) {
  const ref =
    codecId === undefined
      ? ParamRef.of(value, { name: column })
      : ParamRef.of(value, { name: column, codecId });
  return SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(BinaryExpr.eq(ColumnRef.of('user', column), ref));
}

describe('renderLoweredSql cast policy', () => {
  it('emits $N::<nativeType> when the codec nativeType is outside the inferrable set', () => {
    const fooCodec: Codec = codec({
      typeId: 'app/test-foo@1',
      targetTypes: ['foo'],
      encode: (value: string): string => value,
      decode: (wire: string): string => wire,
      meta: { db: { sql: { postgres: { nativeType: 'foo' } } } },
    });
    const lookup: CodecLookup = {
      get: (id) => (id === 'app/test-foo@1' ? fooCodec : undefined),
    };

    const ast = selectWithParam('tag', 'app/test-foo@1', 'tagged');
    const lowered = renderLoweredSql(ast, baseContract, lookup);

    expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."tag" = $1::foo');
  });

  it('emits plain $N when the codec nativeType is inferrable', () => {
    const integerCodec: Codec = codec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (value: number): number => value,
      decode: (wire: number): number => wire,
      meta: { db: { sql: { postgres: { nativeType: 'integer' } } } },
    });
    const lookup: CodecLookup = {
      get: (id) => (id === 'pg/int4@1' ? integerCodec : undefined),
    };

    const ast = selectWithParam('score', 'pg/int4@1', 1);
    const lowered = renderLoweredSql(ast, baseContract, lookup);

    expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."score" = $1');
  });

  it('emits plain $N when the codec carries no nativeType metadata', () => {
    const enumCodec: Codec = codec({
      typeId: 'pg/enum@1',
      targetTypes: ['enum'],
      encode: (value: string): string => value,
      decode: (wire: string): string => wire,
    });
    const lookup: CodecLookup = {
      get: (id) => (id === 'pg/enum@1' ? enumCodec : undefined),
    };

    const ast = selectWithParam('note', 'pg/enum@1', 'urgent');
    const lowered = renderLoweredSql(ast, baseContract, lookup);

    expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."note" = $1');
  });

  it('throws a clear error when the codec lookup has no entry for the codecId', () => {
    // A `codecId` on a `ParamRef` that resolves to no codec in the assembled
    // lookup is a stack-configuration failure, not a fallback opportunity:
    // it almost always means an extension pack is missing from the runtime
    // stack. Surface it loudly at lower-time so callers fix the configuration
    // rather than silently emitting an uncast `$N` or guessing from contract
    // storage. (See ADR 205 § "Adapters built without a stack".)
    const lookup: CodecLookup = { get: () => undefined };

    const ast = selectWithParam('tag', 'app/test-foo@1', 'tagged');

    expect(() => renderLoweredSql(ast, baseContract, lookup)).toThrow(/codecId "app\/test-foo@1"/);
  });

  it('throws even when no contract column references the codecId', () => {
    const lookup: CodecLookup = { get: () => undefined };

    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'unknown', codecId: 'app/never-used@1' }),
        ),
      );

    expect(() => renderLoweredSql(ast, baseContract, lookup)).toThrow(
      /codecId "app\/never-used@1"/,
    );
  });

  it('emits plain $N when the param ref carries no codecId', () => {
    const lookup: CodecLookup = { get: () => undefined };

    const ast = selectWithParam('id', undefined, 1);
    const lowered = renderLoweredSql(ast, baseContract, lookup);

    expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."id" = $1');
  });
});

describe('renderLoweredSql cast policy via stack-derived lookup', () => {
  it('emits the extension-codec cast when the codec is contributed via stack.extensionPacks', () => {
    const geographyCodec: Codec = codec({
      typeId: 'app/geography@1',
      targetTypes: ['geography'],
      encode: (value: string): string => value,
      decode: (wire: string): string => wire,
      meta: { db: { sql: { postgres: { nativeType: 'geography' } } } },
    });

    const geographyExtension: RuntimeExtensionDescriptor<'sql', 'postgres'> = {
      kind: 'extension',
      id: 'app-geography',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      types: {
        codecTypes: {
          codecInstances: [geographyCodec],
        },
      },
      create() {
        return { familyId: 'sql', targetId: 'postgres' };
      },
    };

    const adapter = createComposedPostgresAdapter({ extensionPacks: [geographyExtension] });
    const ast = selectWithParam('geo', 'app/geography@1', 'POINT(0 0)');
    const lowered = adapter.lower(ast, { contract: baseContract });

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."geo" = $1::geography',
    );
  });

  it('emits $1::vector when pgvector is installed via stack.extensionPacks', async () => {
    // Smoke test for the M2 wiring fix: `pgvectorRuntimeDescriptor` exposes
    // its codec instances via `types.codecTypes.codecInstances`, so the
    // adapter's runtime-plane lookup picks up `pg/vector@1` and the renderer
    // emits the cast. Without the wiring fix this regresses to `$1`.
    const pgvectorRuntime = (await import('@prisma-next/extension-pgvector/runtime')).default;

    const adapter = createComposedPostgresAdapter({ extensionPacks: [pgvectorRuntime] });

    const vectorContract = validateContract<PostgresContract>(
      {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: 'sha256:vector-cast-policy',
        roots: {},
        capabilities: {},
        extensionPacks: {},
        meta: {},
        storage: {
          storageHash: 'sha256:vector-cast-policy',
          tables: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                vec: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        models: {},
      },
      { get: () => undefined },
    );

    const ast = selectWithParam('vec', 'pg/vector@1', [1, 2, 3]);
    const lowered = adapter.lower(ast, { contract: vectorContract });

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."vec" = $1::vector',
    );
  });
});
