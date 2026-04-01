import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('INSERT without returning resolves to empty row', () => {
  const result = db.users.insert({ id: 1, name: 'Alice', email: 'a@b.com' }).build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<Record<never, never>>>();
});

test('INSERT with returning resolves to selected columns', () => {
  const result = db.users
    .insert({ id: 1, name: 'Alice', email: 'a@b.com' })
    .returning('id', 'email')
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; email: string }>>();
});

test('INSERT build return type', () => {
  const result = db.users.insert({ id: 1 }).returning('id', 'name').build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; name: string }>>();
});

test('INSERT build returns SqlQueryPlan', () => {
  const result = db.users.insert({ id: 1 }).returning('id').build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
});

test('UPDATE without returning resolves to empty row', () => {
  const result = db.users
    .update({ name: 'Bob' })
    .where((f, fns) => fns.eq(f.id, 1))
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<Record<never, never>>>();
});

test('UPDATE with WHERE and returning resolves to selected columns', () => {
  const result = db.users
    .update({ name: 'Bob' })
    .where((f, fns) => fns.eq(f.id, 1))
    .returning('id', 'name')
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; name: string }>>();
});

test('UPDATE returning before where preserves row type', () => {
  const result = db.users
    .update({ email: 'new@test.com' })
    .returning('id', 'email')
    .where((f, fns) => fns.eq(f.id, 1))
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; email: string }>>();
});

test('DELETE without returning resolves to empty row', () => {
  const result = db.users
    .delete()
    .where((f, fns) => fns.eq(f.id, 1))
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<Record<never, never>>>();
});

test('DELETE with WHERE and returning resolves to selected columns', () => {
  const result = db.users
    .delete()
    .where((f, fns) => fns.eq(f.id, 1))
    .returning('id', 'email')
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; email: string }>>();
});

test('INSERT returning includes nullable column', () => {
  const result = db.users.insert({ id: 1 }).returning('id', 'invited_by_id').build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; invited_by_id: number | null }>>();
});

test('INSERT values accept codec input types', () => {
  // number for int4, string for text — should compile
  db.users.insert({ id: 1, name: 'Alice', email: 'a@b.com' });

  // nullable column accepts value or undefined (optional)
  db.users.insert({ id: 1, invited_by_id: 42 });
  db.users.insert({ id: 1 }); // invited_by_id omitted — all fields optional
});

test('UPDATE values accept codec input types', () => {
  db.users.update({ name: 'Bob' });
  db.users.update({ email: 'new@test.com', name: 'Bob' });
});

test('returning only accepts valid column names', () => {
  // @ts-expect-error — 'nonexistent' is not a column
  db.users.insert({ id: 1 }).returning('nonexistent');

  // @ts-expect-error — 'nonexistent' is not a column
  db.users.update({ name: 'Bob' }).returning('nonexistent');

  // @ts-expect-error — 'nonexistent' is not a column
  db.users.delete().returning('nonexistent');
});
