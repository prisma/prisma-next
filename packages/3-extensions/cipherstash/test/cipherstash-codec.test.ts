/**
 * Wiring tests for the cipherstash extension's codec lifecycle hooks.
 *
 * Two layers are pinned here:
 *
 *   1. `cipherstash descriptor wiring` — every codec hook is reachable
 *      under `types.codecTypes.controlPlaneHooks` on the descriptor,
 *      and `extractCodecControlHooks` discovers all of them.
 *   2. `planFieldEventOperations driving the cipherstash hook` —
 *      end-to-end through the planner: per-flag add/remove ops are
 *      inlined on contract diffs, and an unchanged contract yields no
 *      ops.
 *
 * Per-codec hook behaviour (flag → index mapping) lives in the
 * sibling test files:
 *
 *   - `cipherstash-codec-string.test.ts`
 *   - `cipherstash-codec-numeric.test.ts`
 *   - `cipherstash-codec-other-codecs.test.ts`
 */

import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import { profileHash } from '@prisma-next/contract/types';
import {
  extractCodecControlHooks,
  planFieldEventOperations,
} from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { buildSqlNamespace, SqlStorage, type StorageTable } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { describe, expect, it } from 'vitest';
import cipherstashExtensionDescriptor from '../src/exports/control';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
} from '../src/extension-metadata/constants';
import {
  cipherstashBigIntCodecHooks,
  cipherstashBooleanCodecHooks,
  cipherstashDateCodecHooks,
  cipherstashDoubleCodecHooks,
  cipherstashJsonCodecHooks,
  cipherstashStringCodecHooks,
} from '../src/migration/cipherstash-codec';

describe('cipherstash descriptor wiring', () => {
  it('exposes every codec hook under types.codecTypes.controlPlaneHooks', () => {
    const hooks = (
      cipherstashExtensionDescriptor as {
        types?: { codecTypes?: { controlPlaneHooks?: Record<string, unknown> } };
      }
    ).types?.codecTypes?.controlPlaneHooks;
    expect(hooks?.[CIPHERSTASH_STRING_CODEC_ID]).toBe(cipherstashStringCodecHooks);
    expect(hooks?.[CIPHERSTASH_DOUBLE_CODEC_ID]).toBe(cipherstashDoubleCodecHooks);
    expect(hooks?.[CIPHERSTASH_BIGINT_CODEC_ID]).toBe(cipherstashBigIntCodecHooks);
    expect(hooks?.[CIPHERSTASH_DATE_CODEC_ID]).toBe(cipherstashDateCodecHooks);
    expect(hooks?.[CIPHERSTASH_BOOLEAN_CODEC_ID]).toBe(cipherstashBooleanCodecHooks);
    expect(hooks?.[CIPHERSTASH_JSON_CODEC_ID]).toBe(cipherstashJsonCodecHooks);
  });

  it('extractCodecControlHooks finds every cipherstash hook on the descriptor', () => {
    const map = extractCodecControlHooks([
      cipherstashExtensionDescriptor as unknown as TargetBoundComponentDescriptor<'sql', string>,
    ]);
    expect(map.get(CIPHERSTASH_STRING_CODEC_ID)).toBe(cipherstashStringCodecHooks);
    expect(map.get(CIPHERSTASH_DOUBLE_CODEC_ID)).toBe(cipherstashDoubleCodecHooks);
    expect(map.get(CIPHERSTASH_BIGINT_CODEC_ID)).toBe(cipherstashBigIntCodecHooks);
    expect(map.get(CIPHERSTASH_DATE_CODEC_ID)).toBe(cipherstashDateCodecHooks);
    expect(map.get(CIPHERSTASH_BOOLEAN_CODEC_ID)).toBe(cipherstashBooleanCodecHooks);
    expect(map.get(CIPHERSTASH_JSON_CODEC_ID)).toBe(cipherstashJsonCodecHooks);
  });
});

describe('planFieldEventOperations driving the cipherstash hook', () => {
  function userTable(typeParams?: Record<string, unknown>): StorageTable {
    return {
      columns: {
        id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        email: {
          codecId: CIPHERSTASH_STRING_CODEC_ID,
          nativeType: 'eql_v2_encrypted',
          nullable: false,
          ...ifDefined('typeParams', typeParams),
        },
      },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    };
  }

  function build(tables: Record<string, StorageTable>): Contract<SqlStorage> {
    return {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('sha256:test'),
      storage: new SqlStorage({
        storageHash: 'sha256:test' as StorageHashBase<string>,
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: buildSqlNamespace({ id: UNBOUND_NAMESPACE_ID, tables }),
        },
      }),
      models: {},
      roots: {},
      capabilities: {},
      extensionPacks: {},
      meta: {},
    };
  }

  const codecHooks = extractCodecControlHooks([
    cipherstashExtensionDescriptor as unknown as TargetBoundComponentDescriptor<'sql', string>,
  ]);

  it('inlines per-flag add ops on first emit (priorContract null) when flags are enabled', () => {
    const ops = planFieldEventOperations({
      priorContract: null,
      newContract: build({ User: userTable({ equality: true, freeTextSearch: true }) }),
      codecHooks,
    });
    expect(ops).toHaveLength(2);
    const ids = ops.map((c) => c.toOp().invariantId).sort();
    expect(ids).toEqual([
      'cipherstash-codec:User.email:add-search-config:match@v1',
      'cipherstash-codec:User.email:add-search-config:unique@v1',
    ]);
  });

  it('inlines per-flag remove ops when previously-flagged column is dropped', () => {
    const prior = build({ User: userTable({ equality: true, freeTextSearch: true }) });
    const newer = build({
      User: { ...userTable(), columns: { id: userTable().columns['id']! } },
    });
    const ops = planFieldEventOperations({
      priorContract: prior,
      newContract: newer,
      codecHooks,
    });
    expect(ops).toHaveLength(2);
    const ids = ops.map((c) => c.toOp().invariantId).sort();
    expect(ids).toEqual([
      'cipherstash-codec:User.email:remove-search-config:match@v1',
      'cipherstash-codec:User.email:remove-search-config:unique@v1',
    ]);
  });

  it('emits nothing when contract is unchanged', () => {
    const c = build({ User: userTable({ equality: true }) });
    expect(planFieldEventOperations({ priorContract: c, newContract: c, codecHooks })).toEqual([]);
  });
});
