#!/usr/bin/env -S node
/**
 * Feature-flags baseline migration — create the `feature_flag` table.
 *
 * Hand-edited (see `docs/architecture docs/adrs/
 * ADR 212 - Contract spaces.md`, Path A) so the operation carries the
 * established `feature-flags:create-feature_flag-v1` invariantId and
 * matches the original handcrafted SQL byte-for-byte.
 *
 * Re-emit `ops.json` / `migration.json` after edits via
 * `node migration.ts` (or `tsx migration.ts` on Node < 24).
 */
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import { Migration, MigrationCLI, rawSql } from '@prisma-next/target-postgres/migration';
import type { PostgresPlanTargetDetails } from '@prisma-next/target-postgres/planner-target-details';
import { FEATURE_FLAG_TABLE, FEATURE_FLAGS_BASELINE_INVARIANT_ID } from '../../src/constants';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:abd6046b098e9dd1d014eb490ca1edfa884631957a4727c76e6d4d1f4e3828be',
    };
  }

  override get operations(): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    return [
      rawSql({
        id: `feature-flags.create-${FEATURE_FLAG_TABLE}`,
        label: `Create table "${FEATURE_FLAG_TABLE}"`,
        operationClass: 'additive',
        invariantId: FEATURE_FLAGS_BASELINE_INVARIANT_ID,
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: FEATURE_FLAG_TABLE },
        },
        precheck: [],
        execute: [
          {
            description: `Create table "${FEATURE_FLAG_TABLE}"`,
            sql: `CREATE TABLE IF NOT EXISTS public."${FEATURE_FLAG_TABLE}" (
        "key" text NOT NULL PRIMARY KEY,
        "enabled" boolean NOT NULL
      )`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
