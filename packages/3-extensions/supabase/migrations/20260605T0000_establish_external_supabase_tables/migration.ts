#!/usr/bin/env -S node
/**
 * Supabase zero-ops baseline migration.
 *
 * Transitions from `EMPTY_CONTRACT_HASH` (null) to the supabase storage
 * hash, establishing the head ref for the supabase extension contract space
 * without emitting any DDL. The `auth.*` and `storage.*` tables are managed
 * by Supabase; this migration records that the supabase contract space has
 * been "installed" (those tables are expected to exist) but takes no action
 * to create them.
 *
 * Authoring loop: `node migration.ts` re-emits `ops.json` + `migration.json`
 * deterministically. The regen script (`scripts/regen-extension-migrations.mjs`)
 * rewrites the `to:` hash when `src/contract/contract.json` changes after a
 * `pnpm build:contract-space` run.
 */
import { Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:73f6cdc4bb9d4e8ec73d4e49360ffae395dad73b44bab7ae0c7766d24d48f9fc',
    };
  }

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
