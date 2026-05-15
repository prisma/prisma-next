/**
 * Type-only acceptance test for the cipherstash operator type-visibility
 * surface.
 *
 * This file is a typecheck-only artifact (the example app's
 * `pnpm typecheck` runs `tsc --project tsconfig.json --noEmit` over
 * `src/**`, so any failure here surfaces in the gate). It pins the
 * surface contract for `cipherstashEq` / `cipherstashIlike`:
 *
 *   - Positive: both operators are reachable on the ORM model
 *     accessor for `cipherstash/string@1`-typed fields (`User.email`).
 *   - Positive: both operators are reachable on the SQL query
 *     builder's `fns` namespace, callable against
 *     `cipherstash/string@1`-typed columns (`f.email`).
 *   - Negative: the operators do not type-check when applied to
 *     `pg/text@1`-typed fields (`User.id`). The locked-in design pins
 *     `self: { codecId: 'cipherstash/string@1' }`, so the surface
 *     must gate by codec.
 *   - Negative (regression-pinned): the framework's `eq` is NOT
 *     reachable on `User.email` because the cipherstash codec
 *     declares no `equality` trait (see
 *     `equality-trait-removal.test.ts` in the extension package).
 *
 * The tests use `// @ts-expect-error` markers + plain assignments
 * rather than a runtime assertion library — `tsc --noEmit` fails the
 * gate the moment any expectation flips.
 *
 * The file is parsed by `tsc` only; nothing here runs at execution
 * time. The `void` cast on the builder chains keeps it that way
 * without tripping `noUnusedLocals` / `noUnusedExpressions`.
 */

import { db } from './db';

// -- Positive: ORM model accessor exposes the operators on email ----------

// `db.orm.User.where((u) => ...)` — the cipherstash search operators
// must be reachable directly on `u.email` (no cast wrapper required).
void db.orm.User.where((u) => u.email.cipherstashEq('alice@example.com'));
void db.orm.User.where((u) => u.email.cipherstashIlike('%@example.com'));

// -- Positive: SQL query builder exposes the operators via fns -----------

// `db.sql.users.select(...).where((f, fns) => fns.cipherstashEq(f.email, ...))`
// — the SQL builder projects extension query operations onto the
// `fns` namespace via `Functions<QC>` (see
// `packages/2-sql/4-lanes/sql-builder/src/expression.ts`). The
// builder must surface `cipherstashEq` / `cipherstashIlike`
// alongside the framework`s built-in `eq`, `gt`, etc.
//
// (The SQL accessor name follows the table's database name, which
// the schema maps to `users` via `@@map("users")` — see the
// reserved-word workaround in `src/prisma/contract.prisma`.)
void db.sql.users
  .select('id')
  .where((f, fns) => fns.cipherstashEq(f.email, 'alice@example.com'))
  .build();
void db.sql.users
  .select('id')
  .where((f, fns) => fns.cipherstashIlike(f.email, '%@example.com'))
  .build();

// -- Negative: operators do NOT appear on pg/text@1 fields ----------------

// `User.id` is `pg/text@1`. The cipherstash operators must NOT be
// reachable on it — the locked-in design pins `self` to
// `cipherstash/string@1`, so any non-cipherstash codec must reject.

void db.orm.User.where((u) =>
  // @ts-expect-error cipherstashEq is not on pg/text@1 columns.
  u.id.cipherstashEq('alice@example.com'),
);

void db.orm.User.where((u) =>
  // @ts-expect-error cipherstashIlike is not on pg/text@1 columns.
  u.id.cipherstashIlike('%alice%'),
);

void db.sql.users
  .select('id')
  .where((f, fns) =>
    // @ts-expect-error cipherstashEq rejects pg/text@1 self.
    fns.cipherstashEq(f.id, 'alice@example.com'),
  )
  .build();

void db.sql.users
  .select('id')
  .where((f, fns) =>
    // @ts-expect-error cipherstashIlike rejects pg/text@1 self.
    fns.cipherstashIlike(f.id, '%alice%'),
  )
  .build();

// -- Negative (regression-pinned): the framework's `eq` is NOT on email ---

// The cipherstash codec declares no `equality` trait, so the
// framework's built-in `eq` must remain unreachable on cipherstash
// columns even after the cipherstash-namespaced operators land.

void db.orm.User.where((u) =>
  // @ts-expect-error regression-pinned: cipherstash columns expose no built-in `eq` (no equality trait).
  u.email.eq('alice@example.com'),
);
