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
