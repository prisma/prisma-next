/**
 * Codec lifecycle hook tests for the date, boolean, and JSON
 * cipherstash codecs.
 *
 * Each codec exposes a narrower flag set than the string codec:
 *
 *   - `cipherstash/date@1`    — `{ equality, orderAndRange }`, cast_as=date
 *   - `cipherstash/boolean@1` — `{ equality }` only,            cast_as=boolean
 *   - `cipherstash/json@1`    — `{ searchableJson }`,           cast_as=jsonb
 *
 * `invariantId` template (shared with the string codec):
 *   `cipherstash-codec:<table>.<field>:<action>:<index>@v1`
 */

import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
} from '../src/extension-metadata/constants';
import {
  cipherstashBooleanCodecHooks,
  cipherstashDateCodecHooks,
  cipherstashJsonCodecHooks,
} from '../src/migration/cipherstash-codec';

const TABLE = 'User';
const FIELD = 'email';

describe('cipherstashDateCodecHooks — cast_as=date', () => {
  it("emits add_search_config(unique) with cast_as='date' when equality flips on", () => {
    const ctxArg = {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: TABLE,
      fieldName: FIELD,
      newField: {
        codecId: CIPHERSTASH_DATE_CODEC_ID,
        nativeType: 'eql_v2_encrypted',
        nullable: false,
        typeParams: { equality: true, orderAndRange: true },
      } as StorageColumn,
    };
    const ops = cipherstashDateCodecHooks.onFieldEvent!('added', ctxArg).map(
      (c) => c.toOp() as SqlMigrationPlanOperation<unknown>,
    );
    expect(ops).toHaveLength(2);
    const sqls = ops.map((o) => o.execute[0]!.sql);
    expect(sqls.some((s) => s.includes(`'unique'`))).toBe(true);
    expect(sqls.some((s) => s.includes(`'ore'`))).toBe(true);
    for (const s of sqls) expect(s).toContain(`'date'`);
  });
});

describe('cipherstashBooleanCodecHooks — equality-only, cast_as=boolean', () => {
  it('emits a single add_search_config(unique) with cast_as=boolean when equality flips on', () => {
    const ctxArg = {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: TABLE,
      fieldName: FIELD,
      newField: {
        codecId: CIPHERSTASH_BOOLEAN_CODEC_ID,
        nativeType: 'eql_v2_encrypted',
        nullable: false,
        typeParams: { equality: true },
      } as StorageColumn,
    };
    const ops = cipherstashBooleanCodecHooks.onFieldEvent!('added', ctxArg).map(
      (c) => c.toOp() as SqlMigrationPlanOperation<unknown>,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!.execute[0]!.sql).toContain(`'unique'`);
    expect(ops[0]!.execute[0]!.sql).toContain(`'boolean'`);
  });

  it('does not emit ore ops — booleans have no orderAndRange flag', () => {
    const ctxArg = {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: TABLE,
      fieldName: FIELD,
      newField: {
        codecId: CIPHERSTASH_BOOLEAN_CODEC_ID,
        nativeType: 'eql_v2_encrypted',
        nullable: false,
        typeParams: { equality: true, orderAndRange: true },
      } as StorageColumn,
    };
    const ops = cipherstashBooleanCodecHooks.onFieldEvent!('added', ctxArg).map(
      (c) => c.toOp() as SqlMigrationPlanOperation<unknown>,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!.execute[0]!.sql).not.toContain(`'ore'`);
  });
});

describe('cipherstashJsonCodecHooks — searchableJson → ste_vec, cast_as=jsonb', () => {
  it('emits add_search_config(ste_vec) with cast_as=jsonb when searchableJson flips on', () => {
    const ctxArg = {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: TABLE,
      fieldName: FIELD,
      newField: {
        codecId: CIPHERSTASH_JSON_CODEC_ID,
        nativeType: 'eql_v2_encrypted',
        nullable: false,
        typeParams: { searchableJson: true },
      } as StorageColumn,
    };
    const ops = cipherstashJsonCodecHooks.onFieldEvent!('added', ctxArg).map(
      (c) => c.toOp() as SqlMigrationPlanOperation<unknown>,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!.execute[0]!.sql).toContain(`'ste_vec'`);
    expect(ops[0]!.execute[0]!.sql).toContain(`'jsonb'`);
  });

  it('emits remove_search_config(ste_vec) on drop when searchableJson was previously enabled', () => {
    const ctxArg = {
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: TABLE,
      fieldName: FIELD,
      priorField: {
        codecId: CIPHERSTASH_JSON_CODEC_ID,
        nativeType: 'eql_v2_encrypted',
        nullable: false,
        typeParams: { searchableJson: true },
      } as StorageColumn,
    };
    const ops = cipherstashJsonCodecHooks.onFieldEvent!('dropped', ctxArg).map(
      (c) => c.toOp() as SqlMigrationPlanOperation<unknown>,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!.execute[0]!.sql).toContain('eql_v2.remove_search_config');
    expect(ops[0]!.execute[0]!.sql).toContain(`'ste_vec'`);
  });
});
