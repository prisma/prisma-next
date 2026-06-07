#!/usr/bin/env -S node
/**
 * Audit baseline migration — create the `audit_event` table.
 *
 * Hand-edited (see `docs/architecture docs/adrs/
 * ADR 212 - Contract spaces.md`, Path A) so the operation carries the
 * established `audit:create-audit_event-v1` invariantId and matches
 * the original handcrafted SQL byte-for-byte (the planner emits an
 * equivalent op without an invariantId; we preserve invariant identity
 * since invariants cannot be renamed once published).
 *
 * Re-emit `ops.json` / `migration.json` after edits via
 * `node migration.ts` (or `tsx migration.ts` on Node < 24).
 */
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import { Migration, MigrationCLI, rawSql } from '@prisma-next/target-postgres/migration';
import type { PostgresPlanTargetDetails } from '@prisma-next/target-postgres/planner-target-details';
import { AUDIT_BASELINE_INVARIANT_ID, AUDIT_EVENT_TABLE } from '../../src/constants';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:975333779a8ca7ec4dacc25cd0e6816b04896d8f5227e2c6e4921760c60ebaa1',
    };
  }

  override get operations(): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    return [
      rawSql({
        id: `audit.create-${AUDIT_EVENT_TABLE}`,
        label: `Create table "${AUDIT_EVENT_TABLE}"`,
        operationClass: 'additive',
        invariantId: AUDIT_BASELINE_INVARIANT_ID,
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: AUDIT_EVENT_TABLE },
        },
        precheck: [],
        execute: [
          {
            description: `Create table "${AUDIT_EVENT_TABLE}"`,
            sql: `CREATE TABLE IF NOT EXISTS public."${AUDIT_EVENT_TABLE}" (
        "id" text NOT NULL PRIMARY KEY,
        "actor" text NOT NULL,
        "action" text NOT NULL
      )`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
