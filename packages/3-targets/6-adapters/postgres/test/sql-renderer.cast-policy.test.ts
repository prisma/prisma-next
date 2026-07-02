import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import { voidParamsSchema } from '@prisma-next/framework-components/codec';
import type { RuntimeExtensionDescriptor } from '@prisma-next/framework-components/execution';
import {
  BinaryExpr,
  ColumnRef,
  ParamRef,
  ProjectionItem,
  SelectAst,
  type Codec as SqlCodec,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@prisma-next/sql-relational-core/codec-descriptor-registry';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';
import { createComposedPostgresAdapter } from './helpers/composed-adapter';
import { defineTestCodec } from './test-codec';

const emptyLookup: CodecLookup = {
  get: () => undefined,
  targetTypesFor: () => undefined,
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

// `Codec`-side static metadata (`targetTypes` / `meta` / `renderOutputType`) retired with the SQL `Codec` narrow (TML-2357); these tests supply the metadata side-by-side with the codec instance to build the `CodecLookup` directly.
interface CodecMetadata {
  readonly targetTypes?: readonly string[];
  readonly meta?: {
    readonly db?: { readonly sql?: { readonly postgres?: { readonly nativeType?: string } } };
  };
  readonly renderOutputType?: (params: Record<string, unknown>) => string | undefined;
  readonly nativeTypeFor?: (typeParams: unknown) => string | undefined;
}

function lookupOf(
  byId: Record<string, { codec: SqlCodec; metadata?: CodecMetadata }>,
): CodecLookup {
  return {
    get: (id) => byId[id]?.codec as Codec | undefined,
    targetTypesFor: (id) => byId[id]?.metadata?.targetTypes,
    metaFor: (id) => byId[id]?.metadata?.meta,
    renderOutputTypeFor: (id, params) => byId[id]?.metadata?.renderOutputType?.(params),
    nativeTypeFor: (id, typeParams) => byId[id]?.metadata?.nativeTypeFor?.(typeParams),
  };
}

const baseContract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:cast-policy-test',
  roots: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  storage: {
    storageHash: 'sha256:cast-policy',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                tag: { codecId: 'app/test-foo@1', nativeType: 'foo', nullable: false },
                score: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                note: { codecId: 'app/test-opaque@1', nativeType: 'tag', nullable: false },
                geo: { codecId: 'app/geography@1', nativeType: 'geography', nullable: false },
                profile: { codecId: 'arktype/json@1', nativeType: 'jsonb', nullable: false },
                status: {
                  codecId: 'pg/enum@1',
                  nativeType: 'aal_level',
                  nullable: false,
                  typeParams: { typeName: 'aal_level' },
                },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
  domain: applicationDomainOf({ models: {} }),
}) as PostgresContract;

function selectWithParam(column: string, codecId: string | undefined, value: unknown) {
  const ref =
    codecId === undefined
      ? ParamRef.of(value, { name: column })
      : ParamRef.of(value, { name: column, codec: { codecId } });
  return SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(BinaryExpr.eq(ColumnRef.of('user', column), ref));
}

function selectWithTypeParams(
  column: string,
  codecId: string,
  typeParams: JsonValue,
  value: unknown,
) {
  const ref = ParamRef.of(value, { name: column, codec: { codecId, typeParams } });
  return SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(BinaryExpr.eq(ColumnRef.of('user', column), ref));
}

describe('renderLoweredSql cast policy', () => {
  it('emits $N::<nativeType> when the codec nativeType is outside the inferrable set', () => {
    const fooCodec: Codec = defineTestCodec({
      typeId: 'app/test-foo@1',
      encode: (value: string): string => value,
      decode: (wire: string): string => wire,
    });
    const lookup = lookupOf({
      'app/test-foo@1': {
        codec: fooCodec,
        metadata: {
          targetTypes: ['foo'],
          meta: { db: { sql: { postgres: { nativeType: 'foo' } } } },
        },
      },
    });

    const ast = selectWithParam('tag', 'app/test-foo@1', 'tagged');
    const lowered = renderLoweredSql(ast, baseContract, lookup);

    expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."tag" = $1::foo');
  });

  it('emits plain $N when the codec nativeType is inferrable', () => {
    const integerCodec: Codec = defineTestCodec({
      typeId: 'pg/int4@1',
      encode: (value: number): number => value,
      decode: (wire: number): number => wire,
    });
    const lookup = lookupOf({
      'pg/int4@1': {
        codec: integerCodec,
        metadata: {
          targetTypes: ['int4'],
          meta: { db: { sql: { postgres: { nativeType: 'integer' } } } },
        },
      },
    });

    const ast = selectWithParam('score', 'pg/int4@1', 1);
    const lowered = renderLoweredSql(ast, baseContract, lookup);

    expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."score" = $1');
  });

  it('emits $N::<nativeType> for a native-enum column using the codec instance nativeTypeFor hook, not the codec static meta', () => {
    const pgEnumCodec: Codec = defineTestCodec({
      typeId: 'pg/enum@1',
      encode: (value: string): string => value,
      decode: (wire: string): string => wire,
    });
    const lookup = lookupOf({
      'pg/enum@1': {
        codec: pgEnumCodec,
        metadata: {
          targetTypes: ['text'],
          meta: { db: { sql: { postgres: { nativeType: 'text' } } } },
          nativeTypeFor: (typeParams) =>
            typeParams !== null && typeof typeParams === 'object' && 'typeName' in typeParams
              ? String((typeParams as { typeName: unknown }).typeName)
              : undefined,
        },
      },
    });

    const ast = selectWithTypeParams('status', 'pg/enum@1', { typeName: 'aal_level' }, 'aal2');
    const lowered = renderLoweredSql(ast, baseContract, lookup);

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."status" = $1::aal_level',
    );
  });

  it('emits $N::<schema>.<nativeType> for a native-enum column in a non-public schema, using the schema-qualified typeName verbatim', () => {
    const pgEnumCodec: Codec = defineTestCodec({
      typeId: 'pg/enum@1',
      encode: (value: string): string => value,
      decode: (wire: string): string => wire,
    });
    const lookup = lookupOf({
      'pg/enum@1': {
        codec: pgEnumCodec,
        metadata: {
          targetTypes: ['text'],
          meta: { db: { sql: { postgres: { nativeType: 'text' } } } },
          nativeTypeFor: (typeParams) =>
            typeParams !== null && typeof typeParams === 'object' && 'typeName' in typeParams
              ? String((typeParams as { typeName: unknown }).typeName)
              : undefined,
        },
      },
    });

    const ast = selectWithTypeParams('status', 'pg/enum@1', { typeName: 'auth.aal_level' }, 'aal2');
    const lowered = renderLoweredSql(ast, baseContract, lookup);

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."status" = $1::auth.aal_level',
    );
  });

  it('a column whose codec has no nativeTypeFor hook renders plain $N even when its udt-name spelling (int4) differs from static meta (integer)', () => {
    // Built through the real codecRefForStorageColumn path (not a hand-built
    // ref), against the "score" column declared above with nativeType:
    // 'int4' in the contract. A CodecRef must not carry the column's own
    // nativeType: forwarding it once shadowed the codec's static, inferrable
    // meta ('integer') and produced a spurious $1::int4 cast on every
    // non-enum bind.
    const integerCodec: Codec = defineTestCodec({
      typeId: 'pg/int4@1',
      encode: (value: number): number => value,
      decode: (wire: number): number => wire,
    });
    const lookup = lookupOf({
      'pg/int4@1': {
        codec: integerCodec,
        metadata: {
          targetTypes: ['int4'],
          meta: { db: { sql: { postgres: { nativeType: 'integer' } } } },
        },
      },
    });

    const ref = codecRefForStorageColumn(baseContract.storage, '__unbound__', 'user', 'score');
    expect(ref).toEqual({ codecId: 'pg/int4@1' });
    if (ref === undefined) return;
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(ColumnRef.of('user', 'score'), ParamRef.of(1, { name: 'score', codec: ref })),
      );
    const lowered = renderLoweredSql(ast, baseContract, lookup);

    expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."score" = $1');
  });

  it('emits plain $N when the codec carries no nativeType metadata', () => {
    const enumCodec: Codec = defineTestCodec({
      typeId: 'app/test-opaque@1',
      encode: (value: string): string => value,
      decode: (wire: string): string => wire,
    });
    const lookup = lookupOf({
      'app/test-opaque@1': {
        codec: enumCodec,
        metadata: { targetTypes: ['enum'] },
      },
    });

    const ast = selectWithParam('note', 'app/test-opaque@1', 'urgent');
    const lowered = renderLoweredSql(ast, baseContract, lookup);

    expect(lowered.sql).toBe('SELECT "user"."id" AS "id" FROM "user" WHERE "user"."note" = $1');
  });

  it('uses descriptor metadata when a parameterized codec has no id-keyed representative', () => {
    const lookup: CodecLookup = {
      get: () => undefined,
      targetTypesFor: (id) => (id === 'arktype/json@1' ? ['jsonb'] : undefined),
      metaFor: (id) =>
        id === 'arktype/json@1'
          ? { db: { sql: { postgres: { nativeType: 'jsonb' } } } }
          : undefined,
      renderOutputTypeFor: () => undefined,
    };

    const ast = selectWithParam('profile', 'arktype/json@1', { name: 'Ada' });
    const lowered = renderLoweredSql(ast, baseContract, lookup);

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."profile" = $1::jsonb',
    );
  });

  it('throws a clear error when the codec lookup has no entry for the codecId', () => {
    // A `codecId` on a `ParamRef` that resolves to no codec in the assembled lookup is a stack-configuration failure, not a fallback opportunity: it almost always means an extension pack is missing from the runtime stack. Surface it loudly at lower-time so callers fix the configuration rather than silently emitting an uncast `$N` or guessing from contract storage. (See ADR 205 § "Adapters built without a stack".)
    const lookup = emptyLookup;

    const ast = selectWithParam('tag', 'app/test-foo@1', 'tagged');

    expect(() => renderLoweredSql(ast, baseContract, lookup)).toThrow(/codecId "app\/test-foo@1"/);
  });

  it('throws even when no contract column references the codecId', () => {
    const lookup = emptyLookup;

    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'unknown', codec: { codecId: 'app/never-used@1' } }),
        ),
      );

    expect(() => renderLoweredSql(ast, baseContract, lookup)).toThrow(
      /codecId "app\/never-used@1"/,
    );
  });

  it('throws RUNTIME.PARAM_REF_MISSING_CODEC when the param ref carries no codec', () => {
    // AST-bound codec contract: every ParamRef reaching the renderer must carry a CodecRef. A missing codec is a builder bug rather than a fallback opportunity, so surface it loudly.
    const lookup = emptyLookup;

    const ast = selectWithParam('id', undefined, 1);

    expect(() => renderLoweredSql(ast, baseContract, lookup)).toThrow(
      /PARAM_REF_MISSING_CODEC|reached lowering without/,
    );
  });
});

describe('renderLoweredSql cast policy via stack-derived lookup', () => {
  it('emits the extension-codec cast when the codec is contributed via stack.extensionPacks', () => {
    const geographyCodec: Codec = defineTestCodec({
      typeId: 'app/geography@1',
      encode: (value: string): string => value,
      decode: (wire: string): string => wire,
    });

    // Codec-side static metadata (`targetTypes` / `meta`) lives on the codec descriptor (TML-2357); contributors expose it via `types.codecTypes.codecDescriptors`.
    const geographyDescriptor = {
      codecId: 'app/geography@1',
      traits: [],
      targetTypes: ['geography'],
      meta: { db: { sql: { postgres: { nativeType: 'geography' } } } },
      paramsSchema: voidParamsSchema,
      isParameterized: false,
      factory: () => () => geographyCodec,
    } as const;

    const geographyExtension: RuntimeExtensionDescriptor<'sql', 'postgres'> = {
      kind: 'extension',
      id: 'app-geography',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      types: {
        codecTypes: {
          codecDescriptors: [geographyDescriptor],
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

  it('emits the per-instance enum cast through the assembled stack: the builtin pg/enum@1 descriptor exposes nativeTypeFor and the stack lookup wires it', () => {
    // No hand-built lookup — this goes through the production extractCodecLookup
    // path, proving the codec-instance cast works end-to-end from descriptor
    // registration to rendered SQL.
    const adapter = createComposedPostgresAdapter({ extensionPacks: [] });
    const ast = selectWithTypeParams('status', 'pg/enum@1', { typeName: 'auth.aal_level' }, 'aal2');
    const lowered = adapter.lower(ast, { contract: baseContract });

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."status" = $1::auth.aal_level',
    );
  });
});
