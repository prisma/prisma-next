/**
 * Re-export shim for backwards compatibility.
 *
 * The canonical home of these codec types is `@prisma-next/target-postgres`.
 * Generated `contract.d.ts` files emitted by older versions of the SQL
 * contract emitter (TS surface) reference the adapter subpath; this shim
 * keeps those imports resolving while consumers migrate.
 *
 * New code should import from `@prisma-next/target-postgres/codec-types`
 * directly.
 */
export type {
  Bit,
  Char,
  CodecTypes,
  Interval,
  JsonValue,
  Numeric,
  Time,
  Timestamp,
  Timestamptz,
  Timetz,
  VarBit,
  Varchar,
} from '@prisma-next/target-postgres/codec-types';
export { dataTypes } from '@prisma-next/target-postgres/codec-types';
