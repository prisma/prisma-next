/**
 * Codec lifecycle hook tests for `cipherstash:string@1`.
 *
 * Each enabled flag in the column's `typeParams`
 * maps to its own EQL search-config index:
 *
 *   - `equality: true`        → `'unique'` index
 *   - `freeTextSearch: true`  → `'match'`  index
 *   - `orderAndRange: true`   → `'ore'`    index (D6)
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
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import {
  extractCodecControlHooks,
  planFieldEventOperations,
} from '@prisma-next/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
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

    it('emits add_search_config(ore) when typeParams.orderAndRange is true (D6)', () => {
      const ops = onFieldEvent('added', ctx({ next: { typeParams: { orderAndRange: true } } }));
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(
        `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:ore@v1`,
      );
      expect(ops[0]!.execute[0]!.sql).toContain(`'ore'`);
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

  describe('operation labels (first-time-user-readable)', () => {
    it('add op label is action-first / column-first and free of extension jargon', () => {
      const [op] = onFieldEvent('added', ctx({ next: { typeParams: { equality: true } } }));
      expect(op!.label).toBe(`Enable cipherstash search on ${TABLE}.${FIELD}`);
      // Legacy wording must not reappear (regression bar).
      expect(op!.label).not.toContain('Register cipherstash search config');
    });

    it('remove op label is action-first / column-first', () => {
      const [op] = onFieldEvent('dropped', ctx({ prior: { typeParams: { equality: true } } }));
      expect(op!.label).toBe(`Disable cipherstash search on ${TABLE}.${FIELD}`);
      expect(op!.label).not.toContain('Remove cipherstash search config');
    });

    it('altered op labels stay action-first when adding an index alongside an existing one', () => {
      // Codec emits per-flag deltas: flipping `freeTextSearch` on while
      // `equality` stays on produces a single add op (the rotate UX is
      // expressed as add+remove pairs across flag transitions).
      const ops = onFieldEvent(
        'altered',
        ctx({
          prior: { typeParams: { equality: true } },
          next: { typeParams: { equality: true, freeTextSearch: true } },
        }),
      );
      expect(ops).toHaveLength(1);
      expect(ops[0]!.label).toBe(`Enable cipherstash search on ${TABLE}.${FIELD}`);
      expect(ops[0]!.label).not.toContain('Register cipherstash search config');
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

describe('cipherstashDoubleCodecHooks — flag → index mapping', () => {
  // Numeric codecs (`cipherstash/double@1`, `cipherstash/bigint@1`)
  // share the `{ equality, orderAndRange }` flag set; the only delta
  // is the `cast_as` argument (`'double'` vs `'big_int'`).
  function ctxNumeric(args: {
    prior?: Partial<StorageColumn> | undefined;
    next?: Partial<StorageColumn> | undefined;
    codecId: string;
  }): {
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

describe('cipherstashDateCodecHooks — cast_as=date', () => {
  it("emits add_search_config(unique) with cast_as='date' when equality flips on", () => {
    const ctxArg = {
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
