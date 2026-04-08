/**
 * Duplicated from sql-contract to avoid cross-layer dependency
 * (framework authoring cannot depend on the SQL domain's contract package).
 */
type ReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

/**
 * Column type descriptor containing both codec ID and native type.
 * Used when defining columns with descriptor objects instead of string IDs.
 *
 * For parameterized types (e.g., `vector(1536)`), the `typeParams` field
 * carries codec-owned parameters that affect both TypeScript type generation
 * and native DDL output.
 */
export type ColumnTypeDescriptor<TCodecId extends string = string> = {
  readonly codecId: TCodecId;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
  readonly typeRef?: string;
};

/**
 * Index definition for table builder.
 */
export interface IndexDef {
  readonly columns: readonly string[];
  readonly name?: string;
  /**
   * Optional index access method. Extension-specific methods are represented
   * as strings and interpreted by the owning extension package.
   */
  readonly using?: string;
  /**
   * Optional extension-owned index configuration payload.
   */
  readonly config?: Record<string, unknown>;
}

/**
 * Options for configuring a foreign key's name and referential actions.
 */
export type ForeignKeyOptions = {
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
};

/**
 * Foreign key definition for table builder.
 */
export interface ForeignKeyDef extends ForeignKeyOptions {
  readonly columns: readonly string[];
  readonly references: {
    readonly table: string;
    readonly columns: readonly string[];
  };
  readonly constraint?: boolean;
  readonly index?: boolean;
}

export interface ForeignKeyDefaultsState {
  readonly constraint: boolean;
  readonly index: boolean;
}
