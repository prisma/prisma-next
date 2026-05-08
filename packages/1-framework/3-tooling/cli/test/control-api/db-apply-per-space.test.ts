import { describe, expect, it } from 'vitest';
import { pruneSchemaByOtherSpaceContracts } from '../../src/control-api/operations/db-apply-per-space';

/**
 * Unit tests for the duck-typed schema pruner used by `executePerSpaceDbApply`
 * to strip extension-owned tables out of the introspected schema before
 * app-space planning. The helper takes `unknown` for both arguments by design
 * — every family today exposes `storage.tables: Record<string, ...>` and the
 * introspected schema mirrors the same shape, but the helper falls through
 * structurally when either shape doesn't match so a future family with a
 * different storage shape doesn't blow up the orchestrator.
 *
 * @see packages/1-framework/3-tooling/cli/src/control-api/operations/db-apply-per-space.ts
 *   — `pruneSchemaByOtherSpaceContracts`.
 */
describe('pruneSchemaByOtherSpaceContracts', () => {
  describe('duck-typing fall-through (returns input unchanged)', () => {
    it('returns scalar schemas verbatim', () => {
      expect(pruneSchemaByOtherSpaceContracts(null, [])).toBe(null);
      expect(pruneSchemaByOtherSpaceContracts(undefined, [])).toBe(undefined);
      expect(pruneSchemaByOtherSpaceContracts(42, [])).toBe(42);
      expect(pruneSchemaByOtherSpaceContracts('schema', [])).toBe('schema');
    });

    it('returns schemas without a `tables` field unchanged (identity-preserving)', () => {
      const schema = { other: 'shape' };
      expect(pruneSchemaByOtherSpaceContracts(schema, [{ storage: { tables: { x: {} } } }])).toBe(
        schema,
      );
    });

    it('returns schemas whose `tables` is not a plain object unchanged', () => {
      const schema = { tables: 'not-an-object' };
      expect(pruneSchemaByOtherSpaceContracts(schema, [{ storage: { tables: { x: {} } } }])).toBe(
        schema,
      );
    });

    it('skips other-space contracts that do not match the duck-typed shape', () => {
      const schema = { tables: { app_users: { columns: {} }, ext_table: { columns: {} } } };
      const others: ReadonlyArray<unknown> = [
        null,
        'not-an-object',
        { storage: null },
        { storage: { tables: null } },
        { storage: { tables: 'not-a-record' } },
      ];
      // None of the malformed contracts contributes any owned-table names,
      // so the returned schema is identity-equal to the input (zero-cost
      // path).
      expect(pruneSchemaByOtherSpaceContracts(schema, others)).toBe(schema);
    });
  });

  describe('zero-cost path (no other-space contracts)', () => {
    it('returns the schema verbatim when other-space contracts list is empty', () => {
      const schema = { tables: { user: {}, post: {} } };
      expect(pruneSchemaByOtherSpaceContracts(schema, [])).toBe(schema);
    });
  });

  describe('genuine prune', () => {
    it('removes only tables claimed by other-space contracts', () => {
      const schema = {
        tables: {
          app_user: { columns: { id: {} } },
          ext_audit_log: { columns: { id: {} } },
          ext_feature_flag: { columns: { id: {} } },
        },
      };
      const otherContracts = [
        { storage: { tables: { ext_audit_log: { columns: {} } } } },
        { storage: { tables: { ext_feature_flag: { columns: {} } } } },
      ];

      const pruned = pruneSchemaByOtherSpaceContracts(schema, otherContracts) as {
        readonly tables: Record<string, unknown>;
      };

      expect(Object.keys(pruned.tables).sort()).toEqual(['app_user']);
      expect(pruned.tables['app_user']).toBe(schema.tables['app_user']);
    });

    it('preserves orphan tables (live tables owned by no contract) so the planner can flag them as extras', () => {
      const orphanTable = { columns: { id: {} } };
      const schema = {
        tables: {
          app_user: { columns: { id: {} } },
          ext_owned: { columns: { id: {} } },
          orphan_table: orphanTable,
        },
      };
      const otherContracts = [{ storage: { tables: { ext_owned: { columns: {} } } } }];

      const pruned = pruneSchemaByOtherSpaceContracts(schema, otherContracts) as {
        readonly tables: Record<string, unknown>;
      };

      // The genuinely-orphan table must survive the prune so the
      // app-space planner can decide what to do with it (e.g. flag it as
      // an extra). The pruner only knows what is *claimed*; everything
      // unclaimed flows through.
      expect(Object.keys(pruned.tables).sort()).toEqual(['app_user', 'orphan_table']);
      expect(pruned.tables['orphan_table']).toBe(orphanTable);
    });

    it('preserves non-`tables` storage fields on the schema object', () => {
      const schema = {
        tables: { ext_owned: {}, app_user: {} },
        views: { v1: {} },
        meta: { dialect: 'postgres' },
      };
      const otherContracts = [{ storage: { tables: { ext_owned: {} } } }];

      const pruned = pruneSchemaByOtherSpaceContracts(schema, otherContracts) as {
        readonly tables: Record<string, unknown>;
        readonly views: Record<string, unknown>;
        readonly meta: { readonly dialect: string };
      };

      expect(Object.keys(pruned.tables)).toEqual(['app_user']);
      expect(pruned.views).toBe(schema.views);
      expect(pruned.meta).toBe(schema.meta);
    });
  });
});
