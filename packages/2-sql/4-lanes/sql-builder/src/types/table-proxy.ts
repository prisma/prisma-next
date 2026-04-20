import type {
  ExtractCodecTypes,
  ExtractFieldInputTypes,
  ExtractFieldOutputTypes,
  ExtractQueryOperationTypes,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import type {
  DefaultScope,
  EmptyRow,
  JoinSource,
  QueryContext,
  RebindScope,
  Scope,
  StorageTableToScopeTable,
} from '../scope';
import type { TableProxyContract } from './db';
import type { DeleteQuery, InsertQuery, InsertValues, UpdateQuery } from './mutation-query';
import type { WithJoin, WithSelect } from './shared';

type FindModelForTable<C, TableName extends string> = C extends {
  readonly models: infer Models extends Record<
    string,
    { readonly storage: { readonly table: string } }
  >;
}
  ? {
      [M in keyof Models & string]: Models[M]['storage']['table'] extends TableName ? M : never;
    }[keyof Models & string]
  : never;

type FindFieldForColumn<C, ModelName extends string, ColumnName extends string> = C extends {
  readonly models: infer Models extends Record<
    string,
    { readonly storage: { readonly fields: Record<string, { readonly column: string }> } }
  >;
}
  ? ModelName extends keyof Models
    ? {
        [F in keyof Models[ModelName]['storage']['fields'] &
          string]: Models[ModelName]['storage']['fields'][F]['column'] extends ColumnName
          ? F
          : never;
      }[keyof Models[ModelName]['storage']['fields'] & string]
    : never
  : never;

type ResolvedColumnTypes<
  C,
  TableName extends string,
  FieldTypes extends Record<string, Record<string, unknown>>,
> = string extends keyof FieldTypes
  ? Record<string, never>
  : FindModelForTable<C, TableName> extends infer ModelName extends string
    ? ModelName extends keyof FieldTypes
      ? C extends {
          readonly storage: { readonly tables: infer Tables extends Record<string, StorageTable> };
        }
        ? TableName extends keyof Tables
          ? {
              [ColName in keyof Tables[TableName]['columns'] & string]: FindFieldForColumn<
                C,
                ModelName,
                ColName
              > extends infer FieldName extends string
                ? FieldName extends keyof FieldTypes[ModelName]
                  ? FieldTypes[ModelName][FieldName]
                  : unknown
                : unknown;
            }
          : Record<string, never>
        : Record<string, never>
      : Record<string, never>
    : Record<string, never>;

type ResolvedInsertValues<
  C,
  Table extends StorageTable,
  TableName extends string,
  CT extends Record<string, { readonly input: unknown }>,
  FieldInputs extends Record<string, Record<string, unknown>>,
> = string extends keyof FieldInputs
  ? InsertValues<Table, CT>
  : FindModelForTable<C, TableName> extends infer ModelName extends string
    ? ModelName extends keyof FieldInputs
      ? {
          [K in keyof Table['columns']]?: FindFieldForColumn<
            C,
            ModelName,
            K & string
          > extends infer FieldName extends string
            ? FieldName extends keyof FieldInputs[ModelName]
              ? Table['columns'][K]['nullable'] extends true
                ? NonNullable<FieldInputs[ModelName][FieldName]> | null
                : NonNullable<FieldInputs[ModelName][FieldName]>
              : Table['columns'][K]['codecId'] extends keyof CT
                ? CT[Table['columns'][K]['codecId']]['input']
                : unknown
            : Table['columns'][K]['codecId'] extends keyof CT
              ? CT[Table['columns'][K]['codecId']]['input']
              : unknown;
        }
      : InsertValues<Table, CT>
    : InsertValues<Table, CT>;

type ResolvedUpdateValues<
  C,
  Table extends StorageTable,
  TableName extends string,
  CT extends Record<string, { readonly input: unknown }>,
  FieldInputs extends Record<string, Record<string, unknown>>,
> = ResolvedInsertValues<C, Table, TableName, CT, FieldInputs>;

type ContractToQC<C extends TableProxyContract, Name extends string = string> = {
  readonly codecTypes: ExtractCodecTypes<C>;
  readonly capabilities: C['capabilities'];
  readonly queryOperationTypes: ExtractQueryOperationTypes<C>;
  readonly resolvedColumnOutputTypes: ResolvedColumnTypes<C, Name, ExtractFieldOutputTypes<C>>;
};

export interface TableProxy<
  C extends TableProxyContract,
  Name extends string & keyof C['storage']['tables'],
  Alias extends string = Name,
  AvailableScope extends Scope = DefaultScope<Name, C['storage']['tables'][Name]>,
  QC extends QueryContext = ContractToQC<C, Name>,
> extends JoinSource<StorageTableToScopeTable<C['storage']['tables'][Name]>, Alias>,
    WithSelect<QC, AvailableScope, EmptyRow>,
    WithJoin<QC, AvailableScope, C['capabilities']> {
  as<NewAlias extends string>(
    newAlias: NewAlias,
  ): TableProxy<C, Name, NewAlias, RebindScope<AvailableScope, Alias, NewAlias>>;

  insert(
    values: ResolvedInsertValues<
      C,
      C['storage']['tables'][Name],
      Name,
      QC['codecTypes'],
      ExtractFieldInputTypes<C>
    >,
  ): InsertQuery<QC, AvailableScope, EmptyRow>;

  update(
    set: ResolvedUpdateValues<
      C,
      C['storage']['tables'][Name],
      Name,
      QC['codecTypes'],
      ExtractFieldInputTypes<C>
    >,
  ): UpdateQuery<QC, AvailableScope, EmptyRow>;

  delete(): DeleteQuery<QC, AvailableScope, EmptyRow>;
}
