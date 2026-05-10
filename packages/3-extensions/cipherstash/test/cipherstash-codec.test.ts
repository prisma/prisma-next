/**
 * Codec lifecycle hook tests for `cipherstash:string@1`.
 *
 * Covers the per-event behaviour table from sub-spec § 4 and the
 * planner-side wiring (the SQL family's `extractCodecControlHooks`
 * reads hooks from `descriptor.types.codecTypes.controlPlaneHooks`,
 * and `planFieldEventOperations` dispatches per `(table, field)` based
 * on the field's `codecId`). The codec runtime path (encoding/
 * decoding `Encrypted<string>` payloads) is out of scope for this file.
 */

import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import { profileHash } from '@prisma-next/contract/types';
import {
  extractCodecControlHooks,
  planFieldEventOperations,
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

describe('cipherstashStringCodecHooks.onFieldEvent', () => {
  const onFieldEvent = cipherstashStringCodecHooks.onFieldEvent!;

  describe("event 'added'", () => {
    it('emits add_search_config when newField has searchable: true', () => {
      const ops = onFieldEvent('added', ctx({ next: { typeParams: { searchable: true } } }));
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(`cipherstash-codec:${TABLE}.${FIELD}:add-search-config@v1`);
      expect(ops[0]!.execute[0]!.sql).toContain('eql_v2.add_search_config');
      expect(ops[0]!.execute[0]!.sql).toContain(`'${TABLE}'`);
      expect(ops[0]!.execute[0]!.sql).toContain(`'${FIELD}'`);
    });

    it('emits nothing when typeParams.searchable is missing or false', () => {
      expect(onFieldEvent('added', ctx({ next: {} }))).toEqual([]);
      expect(onFieldEvent('added', ctx({ next: { typeParams: {} } }))).toEqual([]);
      expect(onFieldEvent('added', ctx({ next: { typeParams: { searchable: false } } }))).toEqual(
        [],
      );
    });
  });

  describe("event 'dropped'", () => {
    it('emits remove_search_config when priorField had searchable: true', () => {
      const ops = onFieldEvent('dropped', ctx({ prior: { typeParams: { searchable: true } } }));
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(
        `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config@v1`,
      );
      expect(ops[0]!.execute[0]!.sql).toContain('eql_v2.remove_search_config');
    });

    it('emits nothing when prior column was not searchable', () => {
      expect(onFieldEvent('dropped', ctx({ prior: {} }))).toEqual([]);
      expect(
        onFieldEvent('dropped', ctx({ prior: { typeParams: { searchable: false } } })),
      ).toEqual([]);
    });
  });

  describe("event 'altered'", () => {
    it('emits a rotate op when both sides are searchable but other typeParams differ', () => {
      const ops = onFieldEvent(
        'altered',
        ctx({
          prior: { typeParams: { searchable: true, indexes: ['match'] } },
          next: { typeParams: { searchable: true, indexes: ['match', 'unique'] } },
        }),
      );
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(
        `cipherstash-codec:${TABLE}.${FIELD}:rotate-search-config@v1`,
      );
      expect(ops[0]!.execute).toHaveLength(2);
      expect(ops[0]!.execute[0]!.sql).toContain('eql_v2.remove_search_config');
      expect(ops[0]!.execute[1]!.sql).toContain('eql_v2.add_search_config');
    });

    it('emits nothing when both sides are searchable and all typeParams match', () => {
      const same = { searchable: true, indexes: ['match'] };
      expect(
        onFieldEvent('altered', ctx({ prior: { typeParams: same }, next: { typeParams: same } })),
      ).toEqual([]);
    });

    it('emits add_search_config when only the new side is searchable', () => {
      const ops = onFieldEvent(
        'altered',
        ctx({
          prior: { typeParams: { searchable: false } },
          next: { typeParams: { searchable: true } },
        }),
      );
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(`cipherstash-codec:${TABLE}.${FIELD}:add-search-config@v1`);
    });

    it('emits remove_search_config when only the prior side is searchable', () => {
      const ops = onFieldEvent(
        'altered',
        ctx({
          prior: { typeParams: { searchable: true } },
          next: { typeParams: { searchable: false } },
        }),
      );
      expect(ops).toHaveLength(1);
      expect(ops[0]!.invariantId).toBe(
        `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config@v1`,
      );
    });

    it('emits nothing when neither side is searchable', () => {
      expect(
        onFieldEvent(
          'altered',
          ctx({ prior: { typeParams: {} }, next: { typeParams: { other: 1 } } }),
        ),
      ).toEqual([]);
    });
  });

  describe('operation labels (AC7 — first-time-user-readable)', () => {
    it('add op label is action-first / column-first and free of extension jargon', () => {
      const [op] = onFieldEvent('added', ctx({ next: { typeParams: { searchable: true } } }));
      expect(op!.label).toBe(`Enable cipherstash search on ${TABLE}.${FIELD}`);
      // The pre-M6 wording must not reappear (regression bar).
      expect(op!.label).not.toContain('Register cipherstash search config');
    });

    it('remove op label is action-first / column-first', () => {
      const [op] = onFieldEvent('dropped', ctx({ prior: { typeParams: { searchable: true } } }));
      expect(op!.label).toBe(`Disable cipherstash search on ${TABLE}.${FIELD}`);
      expect(op!.label).not.toContain('Remove cipherstash search config');
    });

    it('rotate op label is action-first / column-first', () => {
      const [op] = onFieldEvent(
        'altered',
        ctx({
          prior: { typeParams: { searchable: true, indexes: ['match'] } },
          next: { typeParams: { searchable: true, indexes: ['match', 'unique'] } },
        }),
      );
      expect(op!.label).toBe(`Rotate cipherstash search on ${TABLE}.${FIELD}`);
      expect(op!.label).not.toContain('Rotate cipherstash search config');
    });
  });

  describe('invariantId + SQL conventions', () => {
    it('namespaces every emitted op under cipherstash-codec:*', () => {
      const allOps = [
        ...onFieldEvent('added', ctx({ next: { typeParams: { searchable: true } } })),
        ...onFieldEvent('dropped', ctx({ prior: { typeParams: { searchable: true } } })),
        ...onFieldEvent(
          'altered',
          ctx({
            prior: { typeParams: { searchable: true, x: 1 } },
            next: { typeParams: { searchable: true, x: 2 } },
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
          next: { typeParams: { searchable: true } },
        }),
      );
      expect(ops[0]!.execute[0]!.sql).toContain("'us''er'");
      expect(ops[0]!.execute[0]!.sql).toContain("'em''ail'");
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
  /**
   * End-to-end fixture exercising the M2 R1 codec-hook plumbing with
   * the real cipherstash hook attached. Mirrors the planner integration
   * site (sub-spec § 5): `extractCodecControlHooks` →
   * `planFieldEventOperations` → ops appended after structural DDL.
   */
  function userTable(searchable: boolean): StorageTable {
    return {
      columns: {
        id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        email: {
          codecId: CIPHERSTASH_STRING_CODEC_ID,
          nativeType: 'eql_v2_encrypted',
          nullable: false,
          typeParams: { searchable },
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

  it('inlines add_search_config on first emit (priorContract null) when searchable', () => {
    const ops = planFieldEventOperations({
      priorContract: null,
      newContract: build({ User: userTable(true) }),
      codecHooks,
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]!.invariantId).toBe('cipherstash-codec:User.email:add-search-config@v1');
  });

  it('inlines remove_search_config when a searchable column is dropped', () => {
    const ops = planFieldEventOperations({
      priorContract: build({ User: userTable(true) }),
      newContract: build({
        User: { ...userTable(true), columns: { id: userTable(true).columns['id']! } },
      }),
      codecHooks,
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]!.invariantId).toBe('cipherstash-codec:User.email:remove-search-config@v1');
  });

  it('emits nothing when contract is unchanged', () => {
    const c = build({ User: userTable(true) });
    expect(planFieldEventOperations({ priorContract: c, newContract: c, codecHooks })).toEqual([]);
  });
});
