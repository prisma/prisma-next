import type { ColumnDefault } from '@prisma-next/contract/types';
import type { DefaultMappingOptions } from './default-mapping';

/**
 * Result of resolving a native database type to a PSL type.
 */
export type PslNativeTypeAttribute = {
  readonly name: string;
  readonly args?: readonly string[];
};

export type PslTypeResolution =
  | {
      readonly pslType: string;
      readonly nativeType: string;
      readonly typeParams?: Record<string, unknown>;
      readonly nativeTypeAttribute?: PslNativeTypeAttribute;
    }
  | {
      readonly unsupported: true;
      readonly nativeType: string;
    };

/**
 * Interface for mapping native database types to PSL scalar types.
 * Implementations are target-specific (e.g., Postgres, MySQL).
 */
export interface PslTypeMap {
  resolve(nativeType: string, annotations?: Record<string, unknown>): PslTypeResolution;
}

/**
 * Options for the PSL printer.
 */
export interface PslPrinterOptions {
  readonly typeMap: PslTypeMap;
  readonly header?: string;
  readonly defaultMapping?: DefaultMappingOptions;
}

/**
 * Normalized column default, accepted by the printer.
 * Re-exported for convenience.
 */
export type { ColumnDefault };

/**
 * A processed field ready for serialization.
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

/**
 * A processed model ready for serialization.
 */
export type PrinterModel = {
  readonly name: string;
  readonly mapName?: string | undefined;
  readonly fields: readonly PrinterField[];
  readonly modelAttributes: readonly string[];
  readonly comment?: string | undefined;
};

/**
 * A processed enum ready for serialization.
 */
export type PrinterEnum = {
  readonly name: string;
  readonly mapName?: string | undefined;
  readonly values: readonly string[];
};

/**
 * A named type entry for the types block.
 */
export type PrinterNamedType = {
  readonly name: string;
  readonly baseType: string;
  readonly attributes: readonly string[];
};

/**
 * Relation field metadata used during inference.
 */
export type RelationField = {
  readonly fieldName: string;
  readonly typeName: string;
  readonly referencedTableName?: string | undefined;
  readonly optional: boolean;
  readonly list: boolean;
  readonly relationName?: string | undefined;
  readonly fkName?: string | undefined;
  readonly fields?: readonly string[] | undefined;
  readonly references?: readonly string[] | undefined;
  readonly onDelete?: string | undefined;
  readonly onUpdate?: string | undefined;
};
