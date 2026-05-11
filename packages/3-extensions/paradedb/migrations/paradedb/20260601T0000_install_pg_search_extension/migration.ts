#!/usr/bin/env -S node
/**
 * paradedb baseline migration — install the `pg_search` Postgres
 * extension and register the invariantId for the BM25 full-text search
 * surface downstream consumers depend on.
 *
 * The contract IR (see `<package>/src/contract/contract.json`) declares no tables or
 * native types — paradedb ships none of its own. The single op here
 * carries the `CREATE EXTENSION IF NOT EXISTS pg_search` DDL plus pre-
 * and postconditions; downstream BM25 indexes in user contracts rely on
 * this op having applied first.
 *
 * The op carries the stable `paradedb:install-pg-search-v1` invariantId
 * — once published it is immutable.
 *
 * Authoring loop: this file is hand-edited (Path B — see
 * `docs/architecture docs/adrs/ADR 212 - Contract spaces.md`,
 * on-disk-in-package authoring section). The CLI's `migration plan`
 * command refuses to scaffold this directory because paradedb's
 * contract has no tables / models for the planner to diff. The migration
 * directory + Migration subclass + a seed `migration.json` were authored
 * by hand; `pnpm tsx migrations/paradedb/<dirName>/migration.ts` then
 * re-emits `ops.json` + `migration.json` deterministically.
 */
import { Migration, MigrationCLI, rawSql } from '@prisma-next/target-postgres/migration';
import { PARADEDB_INVARIANTS } from '../../../src/core/constants';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:7d13ea93bd4726b9962c00ced807a79149e3ff69e0a47d936c0e82f39a637393',
    };
  }

  override get operations() {
    return [
      rawSql({
        id: 'paradedb.install-pg-search-extension',
        label: 'Enable extension "pg_search"',
        operationClass: 'additive',
        invariantId: PARADEDB_INVARIANTS.installPgSearch,
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'extension',
            name: 'pg_search',
          },
        },
        precheck: [
          {
            description: 'verify extension "pg_search" is not already enabled',
            sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_search')",
          },
        ],
        execute: [
          {
            description: 'create extension "pg_search"',
            sql: 'CREATE EXTENSION IF NOT EXISTS pg_search',
          },
        ],
        postcheck: [
          {
            description: 'confirm extension "pg_search" is enabled',
            sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_search')",
          },
        ],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
