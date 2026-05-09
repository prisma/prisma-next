/**
 * Codec lifecycle hook tests for `cipherstash:string@1` — T2.9.
 *
 * Per the umbrella spec each enabled flag in the column's `typeParams`
 * maps to its own EQL search-config index:
 *
 *   - `equality: true`        → `'unique'` index
 *   - `freeTextSearch: true`  → `'match'`  index
 *
 * The codec hook emits **one `add_search_config@v1` op per enabled
 * flag** (Decision option a) — each op is independently invertible by
 * a paired `remove_search_config@v1` op carrying the same index name,
 * which keeps the op-graph simple and the diff per-flag granular.
 *
 * `'altered'` events decompose into per-flag adds and removes against
 * the prior side: a flag flipped on emits an add op for that index, a
 * flag flipped off emits a remove op. Flags whose enabled state did
 * not change yield no op (the index already matches the desired
 * configuration).
 *
 * `invariantId` template:
 *   `cipherstash-codec:<table>.<field>:<action>:<index>@v1`
 *
 * Stable across regenerations — every input is deterministic.
 */

import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import { profileHash } from '@prisma-next/contract/types';
import {
  extractCodecControlHooks,
  planFieldEventOperations,
  type SqlMigrationPlanOperation,
} from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { cipherstashStringCodecHooks } from '../src/core/cipherstash-codec';
import { CIPHERSTASH_STRING_CODEC_ID } from '../src/core/constants';
import cipherstashExtensionDescriptor from '../src/exports/control';

const TABLE = 'User';
const FIELD = 'email';

function ctx(args: {
  prior?: Partial<StorageColumn> | undefined;
  next?: Partial<StorageColumn> | undefined;
  tableName?: string;
  fieldName?: string;
}): {
  readonly tableName: string;
  readonly fieldName: string;
  readonly priorField?: StorageColumn;
  readonly newField?: StorageColumn;
} {
  const baseCol: StorageColumn = {
    codecId: CIPHERSTASH_STRING_CODEC_ID,
    nativeType: 'eql_v2_encrypted',
    nullable: false,
  };
  return {
    tableName: args.tableName ?? TABLE,
    fieldName: args.fieldName ?? FIELD,
    ...(args.prior !== undefined ? { priorField: { ...baseCol, ...args.prior } } : {}),
    ...(args.next !== undefined ? { newField: { ...baseCol, ...args.next } } : {}),
  };
}

describe('cipherstashStringCodecHooks.onFieldEvent — flag → index mapping', () => {
  // The hook returns `OpFactoryCall` instances (ADR 195). These tests
  // verify the runtime op shape, so we lower each Call to its op via
  // `.toOp()` once at the test boundary and assert against the
  // resulting array. Render-side / class-side coverage lives in
  // migration-call-classes.test.ts.
  const onFieldEventCalls = cipherstashStringCodecHooks.onFieldEvent!;
  const onFieldEvent: (
    ...args: Parameters<typeof onFieldEventCalls>
  ) => readonly SqlMigrationPlanOperation<unknown>[] = (...args) =>
    onFieldEventCalls(...args).map((c) => c.toOp() as SqlMigrationPlanOperation<unknown>);

  describe("event 'added' — one add op per enabled flag", () => {
    it('emits add_search_config(unique) when typeParams.equality is true', () => {
      const ops = onFieldEvent('added', ctx({ next: { typeParams: { equality: true } } }));
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(
        `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:unique@v1`,
      );
      expect(ops[0]!.execute[0]!.sql).toContain('eql_v2.add_search_config');
      expect(ops[0]!.execute[0]!.sql).toContain(`'unique'`);
      expect(ops[0]!.execute[0]!.sql).toContain(`'${TABLE}'`);
      expect(ops[0]!.execute[0]!.sql).toContain(`'${FIELD}'`);
    });

    it('emits add_search_config(match) when typeParams.freeTextSearch is true', () => {
      const ops = onFieldEvent('added', ctx({ next: { typeParams: { freeTextSearch: true } } }));
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(
        `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:match@v1`,
      );
      expect(ops[0]!.execute[0]!.sql).toContain(`'match'`);
    });

    it('emits one op per enabled flag when both flags are true', () => {
      const ops = onFieldEvent(
        'added',
        ctx({ next: { typeParams: { equality: true, freeTextSearch: true } } }),
      );
      expect(ops).toHaveLength(2);
      const invariantIds = ops.map((op) => op.invariantId).sort();
      expect(invariantIds).toEqual([
        `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:match@v1`,
        `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:unique@v1`,
      ]);
    });

    it('emits nothing when no flag is enabled', () => {
      expect(onFieldEvent('added', ctx({ next: {} }))).toEqual([]);
      expect(onFieldEvent('added', ctx({ next: { typeParams: {} } }))).toEqual([]);
      expect(
        onFieldEvent(
          'added',
          ctx({ next: { typeParams: { equality: false, freeTextSearch: false } } }),
        ),
      ).toEqual([]);
    });
  });

  describe("event 'dropped' — one remove op per previously-enabled flag", () => {
    it('emits remove_search_config(unique) when prior typeParams.equality was true', () => {
      const ops = onFieldEvent('dropped', ctx({ prior: { typeParams: { equality: true } } }));
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(
        `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config:unique@v1`,
      );
      expect(ops[0]!.execute[0]!.sql).toContain('eql_v2.remove_search_config');
      expect(ops[0]!.execute[0]!.sql).toContain(`'unique'`);
    });

    it('emits remove_search_config(match) when prior typeParams.freeTextSearch was true', () => {
      const ops = onFieldEvent('dropped', ctx({ prior: { typeParams: { freeTextSearch: true } } }));
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(
        `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config:match@v1`,
      );
      expect(ops[0]!.execute[0]!.sql).toContain(`'match'`);
    });

    it('emits one remove op per previously-enabled flag when both flags were true', () => {
      const ops = onFieldEvent(
        'dropped',
        ctx({ prior: { typeParams: { equality: true, freeTextSearch: true } } }),
      );
      expect(ops).toHaveLength(2);
      const invariantIds = ops.map((op) => op.invariantId).sort();
      expect(invariantIds).toEqual([
        `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config:match@v1`,
        `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config:unique@v1`,
      ]);
    });

    it('emits nothing when prior column had no flags enabled', () => {
      expect(onFieldEvent('dropped', ctx({ prior: {} }))).toEqual([]);
      expect(onFieldEvent('dropped', ctx({ prior: { typeParams: { equality: false } } }))).toEqual(
        [],
      );
    });
  });

  describe("event 'altered' — per-flag delta against the prior side", () => {
    it('emits an add op only for flags newly enabled', () => {
      const ops = onFieldEvent(
        'altered',
        ctx({
          prior: { typeParams: { equality: false, freeTextSearch: false } },
          next: { typeParams: { equality: true, freeTextSearch: false } },
        }),
      );
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(
        `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:unique@v1`,
      );
    });

    it('emits a remove op only for flags newly disabled', () => {
      const ops = onFieldEvent(
        'altered',
        ctx({
          prior: { typeParams: { equality: true, freeTextSearch: false } },
          next: { typeParams: { equality: false, freeTextSearch: false } },
        }),
      );
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(
        `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config:unique@v1`,
      );
    });

    it('emits an add and a remove op when one flag flips on while another flips off', () => {
      const ops = onFieldEvent(
        'altered',
        ctx({
          prior: { typeParams: { equality: true, freeTextSearch: false } },
          next: { typeParams: { equality: false, freeTextSearch: true } },
        }),
      );
      expect(ops).toHaveLength(2);
      const invariantIds = ops.map((op) => op.invariantId).sort();
      expect(invariantIds).toEqual([
        `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:match@v1`,
        `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config:unique@v1`,
      ]);
    });

    it('emits nothing when flags are unchanged', () => {
      const same = { equality: true, freeTextSearch: true };
      expect(
        onFieldEvent('altered', ctx({ prior: { typeParams: same }, next: { typeParams: same } })),
      ).toEqual([]);
    });

    it('emits nothing when neither side has flags enabled', () => {
      expect(
        onFieldEvent(
          'altered',
          ctx({ prior: { typeParams: {} }, next: { typeParams: { other: 1 } } }),
        ),
      ).toEqual([]);
    });
  });

  describe('invariantId + SQL conventions', () => {
    it('namespaces every emitted op under cipherstash-codec:*', () => {
      const allOps = [
        ...onFieldEvent(
          'added',
          ctx({ next: { typeParams: { equality: true, freeTextSearch: true } } }),
        ),
        ...onFieldEvent(
          'dropped',
          ctx({ prior: { typeParams: { equality: true, freeTextSearch: true } } }),
        ),
        ...onFieldEvent(
          'altered',
          ctx({
            prior: { typeParams: { equality: false, freeTextSearch: true } },
            next: { typeParams: { equality: true, freeTextSearch: false } },
          }),
        ),
      ];
      expect(allOps.length).toBeGreaterThan(0);
      for (const op of allOps) {
        expect(op.invariantId).toMatch(/^cipherstash-codec:/);
      }
    });

    it('escapes embedded apostrophes in table/field identifiers', () => {
      const ops = onFieldEvent(
        'added',
        ctx({
          tableName: "us'er",
          fieldName: "em'ail",
          next: { typeParams: { equality: true } },
        }),
      );
      expect(ops[0]!.execute[0]!.sql).toContain("'us''er'");
      expect(ops[0]!.execute[0]!.sql).toContain("'em''ail'");
    });

    it('classifies add ops as additive and remove ops as destructive', () => {
      const adds = onFieldEvent(
        'added',
        ctx({ next: { typeParams: { equality: true, freeTextSearch: true } } }),
      );
      const removes = onFieldEvent(
        'dropped',
        ctx({ prior: { typeParams: { equality: true, freeTextSearch: true } } }),
      );
      for (const op of adds) {
        expect(op.operationClass).toBe('additive');
      }
      for (const op of removes) {
        expect(op.operationClass).toBe('destructive');
      }
    });
  });
});

describe('cipherstash descriptor wiring', () => {
  it('exposes the codec hook under types.codecTypes.controlPlaneHooks', () => {
    const hooks = (
      cipherstashExtensionDescriptor as {
        types?: { codecTypes?: { controlPlaneHooks?: Record<string, unknown> } };
      }
    ).types?.codecTypes?.controlPlaneHooks;
    expect(hooks?.[CIPHERSTASH_STRING_CODEC_ID]).toBe(cipherstashStringCodecHooks);
  });

  it('extractCodecControlHooks finds the cipherstash hook on the descriptor', () => {
    const map = extractCodecControlHooks([
      cipherstashExtensionDescriptor as unknown as TargetBoundComponentDescriptor<'sql', string>,
    ]);
    expect(map.get(CIPHERSTASH_STRING_CODEC_ID)).toBe(cipherstashStringCodecHooks);
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
          ...(typeParams !== undefined ? { typeParams } : {}),
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
      storage: {
        storageHash: 'sha256:test' as StorageHashBase<string>,
        tables,
      },
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
