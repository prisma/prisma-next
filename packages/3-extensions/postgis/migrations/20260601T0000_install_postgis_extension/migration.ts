#!/usr/bin/env -S node
/**
 * postgis baseline migration — install the `postgis` Postgres extension
 * and register the invariantId for `geometry(SRID)` columns downstream
 * consumers depend on.
 *
 * The contract IR (see `<package>/src/contract.json`) declares only the
 * parameterised native type `geometry` under `storage.types` — postgis
 * ships no tables of its own. The single op here carries the
 * `CREATE EXTENSION IF NOT EXISTS postgis` DDL plus a postcondition
 * that confirms the extension landed; downstream user columns naming
 * `geometry` as `nativeType` rely on this op having applied first.
 *
 * The op carries the stable `postgis:install-postgis-v1` invariantId —
 * once published it is immutable.
 *
 * Authoring loop: this file is hand-edited. The CLI's `migration plan`
 * command refuses to scaffold this directory because postgis's
 * contract has no tables / models for the planner to diff (only a
 * `storage.types` registration, which the planner doesn't translate
 * into a DDL op). The migration directory + Migration subclass + a
 * seed `migration.json` (preserving the full `toContract` so
 * `MigrationCLI.run` re-attests it without synthesising a stub) were
 * authored by hand; `node migration.ts` then re-emits `ops.json` +
 * `migration.json` deterministically.
 */
import { installExtension, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';
import { POSTGIS_INVARIANTS } from '../../src/core/contract-space-constants';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:4531939920338420868e475b9a26c7ba06cc320e1e68a69e21075c07578d0e80',
    };
  }

  override get operations() {
    return [
      installExtension({
        id: 'postgis.install-postgis-extension',
        extensionName: 'postgis',
        invariantId: POSTGIS_INVARIANTS.installPostgis,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
