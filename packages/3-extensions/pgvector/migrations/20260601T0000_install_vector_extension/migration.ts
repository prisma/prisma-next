#!/usr/bin/env -S node
/**
 * pgvector baseline migration — install the `vector` Postgres
 * extension and register the invariantId for `vector(N)` columns
 * downstream consumers depend on.
 *
 * The contract IR (see `<package>/src/contract.json`) declares only the
 * parameterised native type `vector(N)` under `storage.types` — pgvector
 * ships no tables of its own. The single op here carries the
 * `CREATE EXTENSION IF NOT EXISTS vector` DDL plus a postcondition that
 * confirms the extension landed; downstream user columns naming
 * `vector(N)` as `nativeType` rely on this op having applied first.
 *
 * The op carries the stable `pgvector:install-vector-v1` invariantId —
 * once published it is immutable.
 *
 * Authoring loop: this file is hand-edited (Path B — see
 * `docs/architecture docs/adrs/ADR 212 - Contract spaces.md`,
 * contract-space package layout section). The CLI's `migration plan`
 * command refuses to scaffold this directory because pgvector's
 * contract has no tables / models for the planner to diff (only a
 * `storage.types` registration, which the planner doesn't translate
 * into a DDL op). The migration directory + Migration subclass + a
 * seed `migration.json` were authored by hand; `node migration.ts`
 * then re-emits `ops.json` + `migration.json` deterministically.
 */
import { Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';
import { PGVECTOR_INVARIANTS } from '../../src/core/contract-space-constants';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:c7bb9818eb8d86182fff73219e9c27c4f42ff7918bdcabf003324a7c6c814e20',
    };
  }

  override get operations() {
    return [
      this.installExtension({
        id: 'pgvector.install-vector-extension',
        extensionName: 'vector',
        invariantId: PGVECTOR_INVARIANTS.installVector,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
