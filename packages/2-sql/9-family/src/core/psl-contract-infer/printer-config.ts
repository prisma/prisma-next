import type { ColumnDefault } from '@prisma-next/contract/types';
import type { DefaultMappingOptions } from './default-mapping';

/**
 * Printer-shaped configuration for database→PSL inference. These shape-neutral
 * types are exported from the SQL family (`@prisma-next/family-sql/psl-infer`)
 * and consumed by the target that owns the dialect maps and walks its own
 * schema tree (the Postgres target's `inferPostgresPslContract`).
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

export interface PslTypeMap {
  resolve(nativeType: string, annotations?: Record<string, unknown>): PslTypeResolution;
}

export interface EnumInfo {
  readonly typeNames: ReadonlySet<string>;
  readonly definitions: ReadonlyMap<string, readonly string[]>;
}

export interface PslPrinterOptions {
  readonly typeMap: PslTypeMap;
  readonly defaultMapping?: DefaultMappingOptions;
  readonly enumInfo?: EnumInfo;
  readonly parseRawDefault?: (rawDefault: string, nativeType?: string) => ColumnDefault | undefined;
}

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
