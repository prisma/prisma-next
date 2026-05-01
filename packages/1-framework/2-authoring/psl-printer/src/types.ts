/**
 * Internal printer intermediates used by `astDocumentToPrintDocument` →
 * `serializePrintDocument`. These types are package-private and never
 * exported through `src/exports/`.
 */

export type PrinterField = {
  readonly name: string;
  readonly typeName: string;
  readonly optional: boolean;
  readonly list: boolean;
  readonly attributes: readonly string[];
  readonly mapName?: string | undefined;
  readonly isId: boolean;
  readonly isRelation: boolean;
  readonly isUnsupported: boolean;
  readonly comment?: string | undefined;
};

export type PrinterModel = {
  readonly name: string;
  readonly mapName?: string | undefined;
  readonly fields: readonly PrinterField[];
  readonly modelAttributes: readonly string[];
  readonly comment?: string | undefined;
};

/**
 * A printer-internal enum value. `name` is the original storage label as it
 * appeared in the AST or in the producer's input; `serializeEnum` normalises
 * it for emission and emits a per-member `@map(...)` when normalisation
 * changed the printed form (or when the AST already carried an explicit
 * `mapName`), preserving the round-trip through the parser.
 */
export type PrinterEnumValue = {
  readonly name: string;
  readonly mapName?: string | undefined;
};

export type PrinterEnum = {
  readonly name: string;
  readonly mapName?: string | undefined;
  readonly values: readonly PrinterEnumValue[];
};

export type PrinterNamedType = {
  readonly name: string;
  readonly baseType: string;
  readonly attributes: readonly string[];
};
