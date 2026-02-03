/**
 * Codec type definitions for Postgres adapter.
 *
 * This file exports type-only definitions for codec input/output types.
 * These types are imported by contract.d.ts files for compile-time type inference.
 *
 * Runtime codec implementations are provided by the adapter's codec registry.
 */

export type { CodecTypes } from '../core/codecs';
export { dataTypes } from '../core/codecs';

export type Char<N extends number> = string & { readonly __charLength?: N };
export type Varchar<N extends number> = string & { readonly __varcharLength?: N };
export type Numeric<P extends number, S extends number | undefined = undefined> = string & {
  readonly __numericPrecision?: P;
  readonly __numericScale?: S;
};
export type Bit<N extends number> = string & { readonly __bitLength?: N };
export type VarBit<N extends number> = string & { readonly __varbitLength?: N };
export type Timestamp<P extends number | undefined = undefined> = string & {
  readonly __timestampPrecision?: P;
};
export type Timestamptz<P extends number | undefined = undefined> = string & {
  readonly __timestamptzPrecision?: P;
};
export type Time<P extends number | undefined = undefined> = string & {
  readonly __timePrecision?: P;
};
export type Timetz<P extends number | undefined = undefined> = string & {
  readonly __timetzPrecision?: P;
};
export type Interval<P extends number | undefined = undefined> = string & {
  readonly __intervalPrecision?: P;
};
