import type { Codec, Ctx } from '@prisma-next/framework-components/codec';

/**
 * Descriptor for a column's storage type. Carries the data part of the
 * parameterized-codec model (`codecId`, `nativeType`, `typeParams`, `typeRef`)
 * plus an optional `type` slot that holds a higher-order codec factory the
 * column author supplied.
 *
 * The `type` slot is read by the no-emit `FieldOutputType` resolver in
 * `@prisma-next/sql-contract-ts` to derive the column's resolved JS type from
 * the factory's return signature (`(ctx: Ctx) => Codec<…, Js>`). The data part
 * (`codecId`, `nativeType`, `typeParams`) is captured into the contract IR by
 * the contract-authoring builder. See [ADR 205 — Higher-order codecs for
 * parameterized types](../../../../../../docs/architecture%20docs/adrs/ADR%20205%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).
 */
export type ColumnTypeDescriptor<TCodecId extends string = string> = {
  readonly codecId: TCodecId;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
  readonly typeRef?: string;
  /**
   * Optional curried higher-order codec factory. When present, the
   * contract-authoring builder applies it with a synthesized `Ctx` to build the
   * column's runtime codec; the no-emit `FieldOutputType` resolver reads the
   * factory's return type to derive the column's resolved JS type without
   * touching the runtime.
   *
   * Pack authors typically don't write this slot directly — they author a
   * curried factory function and the builder threads it onto the descriptor.
   */
  readonly type?: (ctx: Ctx) => Codec;
};

export interface IndexDef {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly using?: string;
  readonly config?: Record<string, unknown>;
}

export interface ForeignKeyDefaultsState {
  readonly constraint: boolean;
  readonly index: boolean;
}
