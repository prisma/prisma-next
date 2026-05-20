/**
 * Codec lifecycle hook tests for the numeric cipherstash codecs
 * (`cipherstash/double@1`, `cipherstash/bigint@1`).
 *
 * Numeric codecs share the `{ equality, orderAndRange }` flag set; the
 * only delta between them is the `cast_as` argument
 * (`'double'` vs `'big_int'`).
 *
 * `invariantId` template (shared with the string codec):
 *   `cipherstash-codec:<table>.<field>:<action>:<index>@v1`
 */

import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
} from '../src/extension-metadata/constants';
import {
  cipherstashBigIntCodecHooks,
  cipherstashDoubleCodecHooks,
} from '../src/migration/cipherstash-codec';

const TABLE = 'User';
const FIELD = 'email';

describe('cipherstashDoubleCodecHooks — flag → index mapping', () => {
  function ctxNumeric(args: {
    prior?: Partial<StorageColumn> | undefined;
    next?: Partial<StorageColumn> | undefined;
    codecId: string;
  }): {
    readonly namespaceId: string;
    readonly tableName: string;
    readonly fieldName: string;
    readonly priorField?: StorageColumn;
    readonly newField?: StorageColumn;
  } {
    const baseCol: StorageColumn = {
      codecId: args.codecId,
      nativeType: 'eql_v2_encrypted',
      nullable: false,
    };
    return {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: TABLE,
      fieldName: FIELD,
      ...(args.prior !== undefined ? { priorField: { ...baseCol, ...args.prior } } : {}),
      ...(args.next !== undefined ? { newField: { ...baseCol, ...args.next } } : {}),
    };
  }

  const onFieldEvent = (
    event: 'added' | 'dropped' | 'altered',
    args: { prior?: Partial<StorageColumn>; next?: Partial<StorageColumn> },
  ): readonly SqlMigrationPlanOperation<unknown>[] =>
    cipherstashDoubleCodecHooks.onFieldEvent!(
      event,
      ctxNumeric({ ...args, codecId: CIPHERSTASH_DOUBLE_CODEC_ID }),
    ).map((c) => c.toOp() as SqlMigrationPlanOperation<unknown>);

  it("emits add_search_config(unique) with cast_as='double' when equality flips on", () => {
    const ops = onFieldEvent('added', { next: { typeParams: { equality: true } } });
    expect(ops).toHaveLength(1);
    expect(ops[0]!.invariantId).toBe(
      `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:unique@v1`,
    );
    expect(ops[0]!.execute[0]!.sql).toContain(`'unique'`);
    expect(ops[0]!.execute[0]!.sql).toContain(`'double'`);
  });

  it("emits add_search_config(ore) with cast_as='double' when orderAndRange flips on", () => {
    const ops = onFieldEvent('added', { next: { typeParams: { orderAndRange: true } } });
    expect(ops).toHaveLength(1);
    expect(ops[0]!.invariantId).toBe(
      `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:ore@v1`,
    );
    expect(ops[0]!.execute[0]!.sql).toContain(`'ore'`);
    expect(ops[0]!.execute[0]!.sql).toContain(`'double'`);
  });

  it('emits one op per enabled flag when both are true', () => {
    const ops = onFieldEvent('added', {
      next: { typeParams: { equality: true, orderAndRange: true } },
    });
    expect(ops).toHaveLength(2);
    const ids = ops.map((o) => o.invariantId).sort();
    expect(ids).toEqual([
      `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:ore@v1`,
      `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:unique@v1`,
    ]);
  });

  it('emits remove ops on drop for previously-enabled flags', () => {
    const ops = onFieldEvent('dropped', {
      prior: { typeParams: { equality: true, orderAndRange: true } },
    });
    expect(ops).toHaveLength(2);
    const ids = ops.map((o) => o.invariantId).sort();
    expect(ids).toEqual([
      `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config:ore@v1`,
      `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config:unique@v1`,
    ]);
  });

  it('emits no ops when freeTextSearch is set (the string-only flag is silently ignored)', () => {
    // Numeric codecs do not register `freeTextSearch` in their
    // `flagToIndex`, so a stale `freeTextSearch: true` slot in
    // `typeParams` produces no ops. Authoring-time PSL/TS rejection
    // catches the mistake earlier — see psl-interpretation.test.ts.
    expect(onFieldEvent('added', { next: { typeParams: { freeTextSearch: true } } })).toEqual([]);
  });
});

describe('cipherstashBigIntCodecHooks — cast_as=big_int', () => {
  it("emits add_search_config(unique) with cast_as='big_int' when equality flips on", () => {
    const ctxArg = {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: TABLE,
      fieldName: FIELD,
      newField: {
        codecId: CIPHERSTASH_BIGINT_CODEC_ID,
        nativeType: 'eql_v2_encrypted',
        nullable: false,
        typeParams: { equality: true },
      } as StorageColumn,
    };
    const ops = cipherstashBigIntCodecHooks.onFieldEvent!('added', ctxArg).map(
      (c) => c.toOp() as SqlMigrationPlanOperation<unknown>,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!.execute[0]!.sql).toContain(`'unique'`);
    expect(ops[0]!.execute[0]!.sql).toContain(`'big_int'`);
  });
});
