import { model } from '@prisma-next/sql-contract-ts/contract-builder';
import { expect, it } from 'vitest';
import { describeSqlMigration } from '../../migration-targets/sql-fanout';

const expectedIntNativeType = { sqlite: 'integer', postgres: 'int4' } as const;

// ---------------------------------------------------------------------------
// Destructive operations (drop table / drop index / replace index)
// ---------------------------------------------------------------------------

describeSqlMigration(
  'Migration E2E - Destructive operations',
  ({ int, text, defineContract, runMigration }) => {
    const DESTRUCTIVE = { allowedOperationClasses: ['additive', 'destructive'] } as const;

    it('drops a table removed from the contract', async () => {
      await runMigration({
        origin: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), name: text } }),
            Legacy: model('Legacy', { fields: { id: int.id(), data: text } }),
          },
        }),
        destination: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: DESTRUCTIVE,
        after: async ({ schema }) => {
          expect(schema.tables['User']).toBeDefined();
          expect(schema.tables['Legacy']).toBeUndefined();
        },
      });
    });

    it('drops an index removed from the contract', async () => {
      await runMigration({
        origin: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), email: text } }).sql((ctx) => ({
              indexes: [ctx.constraints.index(ctx.cols.email, { name: 'idx_users_email' })],
            })),
          },
        }),
        destination: defineContract({
          models: { User: model('User', { fields: { id: int.id(), email: text } }) },
        }),
        policy: DESTRUCTIVE,
        after: async ({ schema }) => {
          expect(schema.tables['User']!.indexes).toHaveLength(0);
        },
      });
    });

    it('replaces an index (drop old + create new)', async () => {
      await runMigration({
        origin: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), email: text, name: text } }).sql(
              (ctx) => ({
                indexes: [ctx.constraints.index(ctx.cols.email, { name: 'idx_email' })],
              }),
            ),
          },
        }),
        destination: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), email: text, name: text } }).sql(
              (ctx) => ({
                indexes: [ctx.constraints.index(ctx.cols.name, { name: 'idx_name' })],
              }),
            ),
          },
        }),
        policy: DESTRUCTIVE,
        after: async ({ schema }) => {
          const cols = schema.tables['User']!.indexes.map((i) => [...i.columns]);
          expect(cols).toContainEqual(['name']);
          expect(cols).not.toContainEqual(['email']);
        },
      });
    });
  },
);

// ---------------------------------------------------------------------------
// Destructive column / constraint changes
// ---------------------------------------------------------------------------

describeSqlMigration(
  'Migration E2E - Destructive column changes',
  ({ name, int, text, defineContract, runMigration }) => {
    const ALL = { allowedOperationClasses: ['additive', 'widening', 'destructive'] } as const;

    it('drops a column', async () => {
      await runMigration({
        origin: defineContract({
          models: {
            User: model('User', {
              fields: {
                id: int.id(),
                name: text,
                legacyField: text.optional().column('legacy_field'),
              },
            }),
          },
        }),
        destination: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: ALL,
        after: async ({ schema }) => {
          expect(schema.tables['User']!.columns['legacy_field']).toBeUndefined();
          expect(schema.tables['User']!.columns['name']).toBeDefined();
        },
      });
    });

    it('changes a column type', async () => {
      await runMigration({
        origin: defineContract({
          models: { Item: model('Item', { fields: { id: int.id(), value: text } }) },
        }),
        destination: defineContract({
          models: { Item: model('Item', { fields: { id: int.id(), value: int.optional() } }) },
        }),
        policy: ALL,
        after: async ({ schema }) => {
          expect(schema.tables['Item']!.columns['value']!.nativeType).toBe(
            expectedIntNativeType[name],
          );
        },
      });
    });

    it('tightens nullability (nullable to NOT NULL)', async () => {
      await runMigration({
        origin: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text.optional() } }) },
        }),
        destination: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: ALL,
        after: async ({ schema }) => {
          expect(schema.tables['User']!.columns['name']!.nullable).toBe(false);
        },
      });
    });

    // Exercises the typed DSL on both sides of the migration:
    //   - `before.db` is typed against the origin contract (User has `temp`);
    //     the insert must include all three fields.
    //   - `after.db` is typed against the destination contract (User has no
    //     `temp`); selecting `temp` would be a compile error.
    // The two contracts are different TypeScript types, so this also proves
    // that the harness threads each contract's literal types through to its
    // phase's `db` correctly.
    it('drops a column and preserves remaining data', async () => {
      await runMigration({
        origin: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), name: text, temp: text.optional() } }),
          },
        }),
        destination: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: ALL,
        before: async ({ db, runtime }) => {
          await runtime.execute(
            db.User.insert({ id: 1, name: 'Alice', temp: 'remove-me' }).build(),
          );
        },
        after: async ({ db, runtime }) => {
          const rows = await runtime.execute(db.User.select('id', 'name').orderBy('id').build());
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ id: 1, name: 'Alice' });
        },
      });
    });

    // Column type change with data preservation. Origin's `value` is text;
    // destination's is integer. Inserts happen via the origin-typed db
    // (string value); selects come back through the destination-typed db
    // (number value). The runtime / adapter handle dialect-specific casts
    // — on sqlite via recreate-table, on postgres via ALTER ... USING.
    it('changes a column type and preserves data', async () => {
      await runMigration({
        origin: defineContract({
          models: { Item: model('Item', { fields: { id: int.id(), value: text } }) },
        }),
        destination: defineContract({
          models: { Item: model('Item', { fields: { id: int.id(), value: int.optional() } }) },
        }),
        policy: ALL,
        before: async ({ db, runtime }) => {
          await runtime.execute(db.Item.insert({ id: 1, value: '42' }).build());
          await runtime.execute(db.Item.insert({ id: 2, value: '0' }).build());
        },
        after: async ({ db, runtime, schema }) => {
          expect(schema.tables['Item']!.columns['value']!.nativeType).toBe(
            expectedIntNativeType[name],
          );
          const rows = await runtime.execute(db.Item.select('id', 'value').orderBy('id').build());
          expect(rows).toHaveLength(2);
          expect(rows[0]).toMatchObject({ id: 1, value: 42 });
          expect(rows[1]).toMatchObject({ id: 2, value: 0 });
        },
      });
    });

    it('combined: drop column + change type + tighten nullability', async () => {
      await runMigration({
        origin: defineContract({
          models: {
            Record: model('Record', {
              fields: {
                id: int.id(),
                value: text.optional(),
                oldField: text.optional().column('old_field'),
              },
            }),
          },
        }),
        destination: defineContract({
          models: { Record: model('Record', { fields: { id: int.id(), value: int } }) },
        }),
        policy: ALL,
        after: async ({ schema }) => {
          expect(schema.tables['Record']!.columns['old_field']).toBeUndefined();
          expect(schema.tables['Record']!.columns['value']!.nativeType).toBe(
            expectedIntNativeType[name],
          );
          expect(schema.tables['Record']!.columns['value']!.nullable).toBe(false);
        },
      });
    });
  },
);
