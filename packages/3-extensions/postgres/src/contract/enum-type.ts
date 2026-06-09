import {
  bindEnumType,
  type ExtractCodecTypesFromPack,
} from '@prisma-next/sql-contract-ts/contract-builder';
import type postgresPack from '@prisma-next/target-postgres/pack';

type PostgresCodecTypes = ExtractCodecTypesFromPack<typeof postgresPack>;

/**
 * Postgres-bound `enumType`. Member values are constrained to the codec's input
 * type from the postgres pack's codec typemap — `pg/text@1` dictates `string`,
 * `pg/int4@1` dictates `number`, and a mismatch is a compile error.
 */
export const enumType = bindEnumType<PostgresCodecTypes>();
