/**
 * CipherStash encryption schema + client.
 *
 * Defines the encrypted-column schema for this app and constructs the
 * `EncryptionClient` from {@link https://www.npmjs.com/package/@cipherstash/stack | `@cipherstash/stack`}.
 * The `Encryption({ schemas })` call talks to ZeroKMS at module-evaluation
 * time (top-level `await`), so env vars must be loaded before this module
 * runs — `dotenv/config` is imported here directly so callers don't have
 * to remember the ordering.
 *
 * Schema parity: every encrypted column declared here must mirror the SQL
 * column the framework hits at query time. The example app maps
 * `User.email` to the `users.email` column (see `prisma/schema.prisma`'s
 * `@@map("users")`); if that mapping changes, keep this file in sync.
 *
 * Required env vars (see `.env.example`):
 *
 *   - `CS_WORKSPACE_CRN`
 *   - `CS_CLIENT_ID`
 *   - `CS_CLIENT_KEY`
 *   - `CS_CLIENT_ACCESS_KEY`
 */

import 'dotenv/config';

import { Encryption } from '@cipherstash/stack';
import type { EncryptionClient } from '@cipherstash/stack/client';
import { encryptedColumn, encryptedTable } from '@cipherstash/stack/schema';

// Per-column search-config matches `prisma/schema.prisma`. The PSL
// constructors default every flag to `true` (per spec FR6), so the
// stack-side schema below mirrors the maximal index surface for each
// codec id. Mismatches here surface at runtime as ZeroKMS rejecting
// the search term against a column whose stack-side index set
// disagrees with the EQL bundle's installed configuration.
//
// Column names are the *physical* (Postgres-side) names, not the
// Prisma model field names: the framework's bulk-encrypt middleware
// addresses each ParamRef by the lowered `(table, column)` pair it
// observed during lowering, which already collapses through
// `@map(...)` to the physical SQL column. Keeping the stack schema
// keyed by physical names keeps the SDK lookup in `sdk.ts` a single
// identity map. The `@map` redirections in `prisma/schema.prisma`
// are a workaround for an EQL bundle camelCase quoting bug
// (see `test/e2e/README.md`).
export const users = encryptedTable('users', {
  email: encryptedColumn('email').equality().freeTextSearch().orderAndRange(),
  salary: encryptedColumn('salary').dataType('number').equality().orderAndRange(),
  accountid: encryptedColumn('accountid').dataType('bigint').equality().orderAndRange(),
  birthday: encryptedColumn('birthday').dataType('date').equality().orderAndRange(),
  emailverified: encryptedColumn('emailverified').dataType('boolean').equality(),
  preferences: encryptedColumn('preferences').dataType('json').searchableJson(),
});

// Explicit annotation to keep the inferred type portable — without it,
// TS resolves through a hashed internal `client-*.d.ts` chunk that lives
// outside the package's public `typesVersions` map (TS2742).
export const encryptionClient: EncryptionClient = await Encryption({ schemas: [users] });
