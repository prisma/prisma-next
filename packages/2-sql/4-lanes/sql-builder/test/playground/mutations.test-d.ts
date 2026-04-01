import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('INSERT without returning resolves to empty row', () => {
  const result = db.users.insert({ id: 1, name: 'Alice', email: 'a@b.com' }).first();
  expectTypeOf(result).toEqualTypeOf<Promise<Record<never, never> | null>>();
});

test('INSERT with returning resolves to selected columns', () => {
  const result = db.users
    .insert({ id: 1, name: 'Alice', email: 'a@b.com' })
    .returning('id', 'email')
    .first();
  expectTypeOf(result).toEqualTypeOf<Promise<{ id: number; email: string } | null>>();
});

test('INSERT firstOrThrow omits null from return type', () => {
  const result = db.users.insert({ id: 1 }).returning('id', 'name').firstOrThrow();
  expectTypeOf(result).toEqualTypeOf<Promise<{ id: number; name: string }>>();
});

test('INSERT all returns AsyncIterable', () => {
  const result = db.users.insert({ id: 1 }).returning('id').all();
  expectTypeOf(result).toEqualTypeOf<AsyncIterable<{ id: number }>>();
});

test('UPDATE without returning resolves to empty row', () => {
  const result = db.users
    .update({ name: 'Bob' })
    .where((f, fns) => fns.eq(f.id, 1))
    .first();
  expectTypeOf(result).toEqualTypeOf<Promise<Record<never, never> | null>>();
});

test('UPDATE with WHERE and returning resolves to selected columns', () => {
  const result = db.users
    .update({ name: 'Bob' })
    .where((f, fns) => fns.eq(f.id, 1))
    .returning('id', 'name')
    .first();
  expectTypeOf(result).toEqualTypeOf<Promise<{ id: number; name: string } | null>>();
});

test('UPDATE returning before where preserves row type', () => {
  const result = db.users
    .update({ email: 'new@test.com' })
    .returning('id', 'email')
    .where((f, fns) => fns.eq(f.id, 1))
    .first();
  expectTypeOf(result).toEqualTypeOf<Promise<{ id: number; email: string } | null>>();
});

test('DELETE without returning resolves to empty row', () => {
  const result = db.users
    .delete()
    .where((f, fns) => fns.eq(f.id, 1))
    .first();
  expectTypeOf(result).toEqualTypeOf<Promise<Record<never, never> | null>>();
});

test('DELETE with WHERE and returning resolves to selected columns', () => {
  const result = db.users
    .delete()
    .where((f, fns) => fns.eq(f.id, 1))
    .returning('id', 'email')
    .first();
  expectTypeOf(result).toEqualTypeOf<Promise<{ id: number; email: string } | null>>();
});

test('INSERT returning includes nullable column', () => {
  const result = db.users.insert({ id: 1 }).returning('id', 'invited_by_id').first();
  expectTypeOf(result).toEqualTypeOf<
    Promise<{ id: number; invited_by_id: number | null } | null>
  >();
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
