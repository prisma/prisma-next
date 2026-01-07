export type {
  ColumnBuilder,
  ColumnBuilderState,
  ColumnTypeDescriptor,
  ContractBuilderState,
  ForeignKeyDef,
  IndexDef,
  ModelBuilderState,
  RelationDefinition,
  TableBuilderState,
  UniqueConstraintDef,
} from './builder-state.ts';

export { ContractBuilder, defineContract } from './contract-builder.ts';
export { ModelBuilder } from './model-builder.ts';
export { createTable, TableBuilder } from './table-builder.ts';

export type {
  BuildModelFields,
  BuildModels,
  BuildRelations,
  BuildStorage,
  BuildStorageColumn,
  BuildStorageTables,
  ExtractColumns,
  ExtractModelFields,
  ExtractModelRelations,
  ExtractPrimaryKey,
  Mutable,
} from './types.ts';
