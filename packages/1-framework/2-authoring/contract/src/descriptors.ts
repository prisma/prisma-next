export type ColumnTypeDescriptor<TCodecId extends string = string> = {
  readonly codecId: TCodecId;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
  readonly typeRef?: string;
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
