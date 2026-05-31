/**
 * Free-standing helper tests — sort + JSON SELECT-expression
 * helpers.
 *
 * These are not registered operators; they're pure functions imported
 * from the runtime entry. The tests here pin:
 *
 *   - **AST shape** — `cipherstashAsc(col)` produces an
 *     `OrderByItem` with `dir: 'asc'` wrapping the column's AST;
 *     `cipherstashDesc` mirrors with `dir: 'desc'`.
 *   - **SQL snapshot** — the lowered SELECT shape with the helper
 *     in `ORDER BY` (sort) or in the projection list (JSON helpers)
 *     pins the user-visible SQL the live-Postgres e2e harness
 *     executes against the EQL bundle.
 *   - **Error path** — each helper rejects a non-cipherstash column
 *     (or, for the JSON helpers, a cipherstash-but-non-JSON column)
 *     with a `TypeError` naming the helper and the accepted codec
 *     ids.
 *
 * Type-level tests are inline in `helpers.types.test-d.ts`; the
 * helpers are typed at their declaration site (no
 * `QueryOperationTypes` entry).
 */

import postgresRuntimeAdapter from '@prisma-next/adapter-postgres/runtime';
import type { PostgresContract } from '@prisma-next/adapter-postgres/types';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import type {
  RuntimeExtensionDescriptor,
  RuntimeTargetDescriptor,
} from '@prisma-next/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  type AnyExpression,
  ColumnRef,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { Expression, ScopeField } from '@prisma-next/sql-relational-core/expression';
import { describe, expect, it, vi } from 'vitest';
import {
  cipherstashAsc,
  cipherstashDesc,
  cipherstashJsonbGet,
  cipherstashJsonbPathQueryFirst,
} from '../src/execution/helpers';
import type { CipherstashSdk } from '../src/execution/sdk';
import { createCipherstashRuntimeDescriptor } from '../src/exports/runtime';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
  EQL_V2_ENCRYPTED_TYPE,
} from '../src/extension-metadata/constants';

function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

const TABLE = 'user';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:cipherstash-helpers-test',
  roots: {},
  capabilities: {},
  extensionPacks: {},
  meta: {},
  storage: {
    storageHash: 'sha256:cipherstash-helpers-test-storage',
    [UNBOUND_NAMESPACE_ID]: {
      id: UNBOUND_NAMESPACE_ID,
      tables: {
        [TABLE]: {
          columns: {
            id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            email: {
              codecId: CIPHERSTASH_STRING_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            score: {
              codecId: CIPHERSTASH_DOUBLE_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            amount: {
              codecId: CIPHERSTASH_BIGINT_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            birthday: {
              codecId: CIPHERSTASH_DATE_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            enabled: {
              codecId: CIPHERSTASH_BOOLEAN_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            payload: {
              codecId: CIPHERSTASH_JSON_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            plain: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
  },
  models: {},
}) as PostgresContract;

const stubRuntimeTarget: RuntimeTargetDescriptor<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',
  create() {
    return { familyId: 'sql', targetId: 'postgres' };
  },
};

function makeAdapter() {
  const cipherstash: RuntimeExtensionDescriptor<'sql', 'postgres'> =
    createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
  return postgresRuntimeAdapter.create({
    target: stubRuntimeTarget,
    adapter: postgresRuntimeAdapter,
    driver: undefined,
    extensionPacks: [cipherstash],
  });
}

function columnAccessor(table: string, column: string, codecId: string): Expression<ScopeField> {
  const ref = ColumnRef.of(table, column);
  return {
    returnType: { codecId, nullable: true },
    buildAst: () => ref,
  };
}

function selectWithOrderBy(items: readonly OrderByItem[]) {
  return SelectAst.from(TableSource.named(TABLE))
    .withProjection([ProjectionItem.of('id', ColumnRef.of(TABLE, 'id'))])
    .withOrderBy(items);
}

function selectWithProjection(name: string, expr: AnyExpression) {
  return SelectAst.from(TableSource.named(TABLE)).withProjection([ProjectionItem.of(name, expr)]);
}

describe('cipherstashAsc / cipherstashDesc — AST shape', () => {
  it('cipherstashAsc returns an OrderByItem with dir asc wrapping the column buildAst', () => {
    const col = columnAccessor(TABLE, 'email', CIPHERSTASH_STRING_CODEC_ID);
    const item = cipherstashAsc(col);
    expect(item).toBeInstanceOf(OrderByItem);
    expect(item).toMatchObject({ dir: 'asc', expr: col.buildAst() });
  });

  it('cipherstashDesc returns an OrderByItem with dir desc wrapping the column buildAst', () => {
    const col = columnAccessor(TABLE, 'score', CIPHERSTASH_DOUBLE_CODEC_ID);
    const item = cipherstashDesc(col);
    expect(item).toBeInstanceOf(OrderByItem);
    expect(item).toMatchObject({ dir: 'desc', expr: col.buildAst() });
  });
});

describe('cipherstashAsc / cipherstashDesc — SQL snapshot', () => {
  it('lowers ORDER BY cipherstashAsc(email) to a bare-column ASC clause', () => {
    const col = columnAccessor(TABLE, 'email', CIPHERSTASH_STRING_CODEC_ID);
    const ast = selectWithOrderBy([cipherstashAsc(col)]);
    const lowered = makeAdapter().lower(ast, { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" ORDER BY "user"."email" ASC"`,
    );
    expect(lowered.params).toHaveLength(0);
  });

  it('lowers ORDER BY cipherstashDesc(birthday) to a bare-column DESC clause', () => {
    const col = columnAccessor(TABLE, 'birthday', CIPHERSTASH_DATE_CODEC_ID);
    const ast = selectWithOrderBy([cipherstashDesc(col)]);
    const lowered = makeAdapter().lower(ast, { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" ORDER BY "user"."birthday" DESC"`,
    );
  });

  it('lowers a multi-key ORDER BY with mixed directions', () => {
    const score = columnAccessor(TABLE, 'score', CIPHERSTASH_DOUBLE_CODEC_ID);
    const amount = columnAccessor(TABLE, 'amount', CIPHERSTASH_BIGINT_CODEC_ID);
    const ast = selectWithOrderBy([cipherstashDesc(score), cipherstashAsc(amount)]);
    const lowered = makeAdapter().lower(ast, { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" ORDER BY "user"."score" DESC, "user"."amount" ASC"`,
    );
  });
});

describe('cipherstashAsc / cipherstashDesc — error paths', () => {
  it('cipherstashAsc rejects a non-cipherstash column', () => {
    const col = columnAccessor(TABLE, 'plain', 'pg/text@1');
    expect(() => cipherstashAsc(col)).toThrowError(
      /cipherstashAsc.*pg\/text@1.*one of.*cipherstash\/string@1.*cipherstash\/double@1.*cipherstash\/bigint@1.*cipherstash\/date@1/s,
    );
  });

  it('cipherstashAsc rejects a cipherstash boolean column (not in order-and-range set)', () => {
    const col = columnAccessor(TABLE, 'enabled', CIPHERSTASH_BOOLEAN_CODEC_ID);
    expect(() => cipherstashAsc(col)).toThrowError(
      /cipherstashAsc.*cipherstash\/boolean@1.*does not support order-and-range/,
    );
  });

  it('cipherstashAsc rejects a cipherstash json column (not in order-and-range set)', () => {
    const col = columnAccessor(TABLE, 'payload', CIPHERSTASH_JSON_CODEC_ID);
    expect(() => cipherstashAsc(col)).toThrowError(/cipherstashAsc.*cipherstash\/json@1/);
  });

  it('cipherstashDesc rejects a non-cipherstash column with the same diagnostic shape', () => {
    const col = columnAccessor(TABLE, 'plain', 'pg/text@1');
    expect(() => cipherstashDesc(col)).toThrowError(/cipherstashDesc.*pg\/text@1/);
  });
});

describe('cipherstashJsonbPathQueryFirst — AST shape and SQL snapshot', () => {
  it('returns an Expression whose returnType is cipherstash/json@1', () => {
    const col = columnAccessor(TABLE, 'payload', CIPHERSTASH_JSON_CODEC_ID);
    const expr = cipherstashJsonbPathQueryFirst(col, '$.user.email');
    expect(expr.returnType).toEqual({ codecId: CIPHERSTASH_JSON_CODEC_ID, nullable: false });
    const ast = expr.buildAst();
    expect(ast.kind).toBe('operation');
  });

  it('lowers to eql_v2.jsonb_path_query_first("payload", $1) with the path bound as pg/text@1', () => {
    const col = columnAccessor(TABLE, 'payload', CIPHERSTASH_JSON_CODEC_ID);
    const expr = cipherstashJsonbPathQueryFirst(col, '$.user.email');
    const ast = selectWithProjection('first_email', expr.buildAst());
    const lowered = makeAdapter().lower(ast, { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT eql_v2.jsonb_path_query_first("user"."payload", $1) AS "first_email" FROM "user""`,
    );
    expect(lowered.params).toEqual([{ kind: 'literal', value: '$.user.email' }]);
  });
});

describe('cipherstashJsonbGet — AST shape and SQL snapshot', () => {
  it('returns an Expression whose returnType is cipherstash/json@1', () => {
    const col = columnAccessor(TABLE, 'payload', CIPHERSTASH_JSON_CODEC_ID);
    const expr = cipherstashJsonbGet(col, 'email');
    expect(expr.returnType).toEqual({ codecId: CIPHERSTASH_JSON_CODEC_ID, nullable: false });
  });

  it('lowers to eql_v2."->"("payload", $1) with the key bound as pg/text@1', () => {
    const col = columnAccessor(TABLE, 'payload', CIPHERSTASH_JSON_CODEC_ID);
    const expr = cipherstashJsonbGet(col, 'email');
    const ast = selectWithProjection('email_field', expr.buildAst());
    const lowered = makeAdapter().lower(ast, { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT eql_v2."->"("user"."payload", $1) AS "email_field" FROM "user""`,
    );
    expect(lowered.params).toEqual([{ kind: 'literal', value: 'email' }]);
  });
});

describe('cipherstashJsonbPathQueryFirst / cipherstashJsonbGet — error paths', () => {
  it('cipherstashJsonbPathQueryFirst rejects a non-cipherstash column', () => {
    const col = columnAccessor(TABLE, 'plain', 'pg/text@1');
    expect(() => cipherstashJsonbPathQueryFirst(col, '$.foo')).toThrowError(
      /cipherstashJsonbPathQueryFirst.*pg\/text@1.*cipherstash\/json@1/,
    );
  });

  it('cipherstashJsonbPathQueryFirst rejects a cipherstash-but-non-json column', () => {
    const col = columnAccessor(TABLE, 'email', CIPHERSTASH_STRING_CODEC_ID);
    expect(() => cipherstashJsonbPathQueryFirst(col, '$.foo')).toThrowError(
      /cipherstashJsonbPathQueryFirst.*cipherstash\/string@1.*cipherstash\/json@1/,
    );
  });

  it('cipherstashJsonbPathQueryFirst rejects a non-string path', () => {
    const col = columnAccessor(TABLE, 'payload', CIPHERSTASH_JSON_CODEC_ID);
    expect(() => cipherstashJsonbPathQueryFirst(col, 42 as unknown as string)).toThrowError(
      /cipherstashJsonbPathQueryFirst.*string path.*number/,
    );
  });

  it('cipherstashJsonbGet rejects a non-json cipherstash column with a json-specific diagnostic', () => {
    const col = columnAccessor(TABLE, 'score', CIPHERSTASH_DOUBLE_CODEC_ID);
    expect(() => cipherstashJsonbGet(col, 'foo')).toThrowError(
      /cipherstashJsonbGet.*cipherstash\/double@1.*cipherstash\/json@1/,
    );
  });

  it('cipherstashJsonbGet rejects a non-string path', () => {
    const col = columnAccessor(TABLE, 'payload', CIPHERSTASH_JSON_CODEC_ID);
    expect(() => cipherstashJsonbGet(col, null as unknown as string)).toThrowError(
      /cipherstashJsonbGet.*string path.*null/,
    );
  });
});
