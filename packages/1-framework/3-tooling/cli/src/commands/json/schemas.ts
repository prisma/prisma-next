import { type } from 'arktype';

export const migrationEntrySchema = type({
  name: 'string',
  hash: 'string',
  fromContract: 'string | null',
  toContract: 'string',
  operationCount: 'number',
  createdAt: 'string',
  refs: 'string[]',
  providedInvariants: 'string[]',
});

export type MigrationEntry = typeof migrationEntrySchema.infer;

export const contractRefSchema = type({
  hash: 'string',
  refs: 'string[]',
});

export type ContractRef = typeof contractRefSchema.infer;

export const successEnvelopeBaseSchema = type({
  ok: 'true',
  summary: 'string',
});

export type SuccessEnvelopeBase = typeof successEnvelopeBaseSchema.infer;

export const migrationSpaceListEntrySchema = type({
  space: 'string',
  migrations: migrationEntrySchema.array(),
});

export type MigrationSpaceListEntry = typeof migrationSpaceListEntrySchema.infer;

export const migrationListResultSchema = successEnvelopeBaseSchema.and(
  type({
    spaces: migrationSpaceListEntrySchema.array(),
  }),
);

export type MigrationListResult = typeof migrationListResultSchema.infer;

export const graphMigrationSchema = type({
  name: 'string',
  hash: 'string',
  fromContract: 'string',
  toContract: 'string',
});

export type GraphMigration = typeof graphMigrationSchema.infer;

export const migrationSpaceGraphEntrySchema = type({
  space: 'string',
  contracts: contractRefSchema.array(),
  migrations: graphMigrationSchema.array(),
});

export type MigrationSpaceGraphEntry = typeof migrationSpaceGraphEntrySchema.infer;

export const migrationGraphJsonResultSchema = successEnvelopeBaseSchema.and(
  type({
    spaces: migrationSpaceGraphEntrySchema.array(),
  }),
);

export type MigrationGraphJsonResult = typeof migrationGraphJsonResultSchema.infer;

export const migrationStatusEntrySchema = migrationEntrySchema.and(
  type({
    status: '"applied" | "pending" | null',
  }),
);

export type MigrationStatusEntry = typeof migrationStatusEntrySchema.infer;

const contractUnreadableDiagnosticSchema = type({
  code: '"CONTRACT.UNREADABLE"',
  severity: '"warn" | "info"',
  message: 'string',
  hints: 'string[]',
});

const markerNotInHistoryDiagnosticSchema = type({
  code: '"MIGRATION.MARKER_NOT_IN_HISTORY"',
  severity: '"warn" | "info"',
  message: 'string',
  hints: 'string[]',
});

const missingInvariantsDiagnosticSchema = type({
  code: '"MIGRATION.MISSING_INVARIANTS"',
  'ref?': 'string',
  invariants: 'string[]',
  message: 'string',
});

export const statusDiagnosticSchema = contractUnreadableDiagnosticSchema
  .or(markerNotInHistoryDiagnosticSchema)
  .or(missingInvariantsDiagnosticSchema);

export type StatusDiagnosticJson = typeof statusDiagnosticSchema.infer;

export const migrationStatusSpaceSchema = type({
  space: 'string',
  currentContract: 'string | null',
  targetContract: 'string',
  migrations: migrationStatusEntrySchema.array(),
});

export type MigrationStatusSpace = typeof migrationStatusSpaceSchema.infer;

export const migrationStatusJsonResultSchema = successEnvelopeBaseSchema.and(
  type({
    spaces: migrationStatusSpaceSchema.array(),
    diagnostics: statusDiagnosticSchema.array(),
  }),
);

export type MigrationStatusResult = typeof migrationStatusJsonResultSchema.infer;
