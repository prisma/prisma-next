import type {
  ColumnBuilderState,
  ModelBuilderState,
  RelationDefinition,
  TableBuilderState,
} from './builder-state.ts';

export type BuildStorageColumn<Nullable extends boolean, Type extends string> = {
  readonly nativeType: string;
  readonly codecId: Type;
  readonly nullable: Nullable;
};

export type ExtractColumns<
  T extends TableBuilderState<
    string,
    Record<string, ColumnBuilderState<string, boolean, string>>,
    readonly string[] | undefined
  >,
> = T extends TableBuilderState<string, infer C, readonly string[] | undefined> ? C : never;

export type ExtractPrimaryKey<
  T extends TableBuilderState<
    string,
    Record<string, ColumnBuilderState<string, boolean, string>>,
    readonly string[] | undefined
  >,
> =
  T extends TableBuilderState<
    string,
    Record<string, ColumnBuilderState<string, boolean, string>>,
    infer PK
  >
    ? PK
    : never;

export type BuildStorage<
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >
  >,
> = {
  readonly tables: {
    readonly [K in keyof Tables]: {
      readonly columns: {
        readonly [ColK in keyof ExtractColumns<Tables[K]>]: ExtractColumns<
          Tables[K]
        >[ColK] extends ColumnBuilderState<string, infer Null, infer TType>
          ? BuildStorageColumn<Null & boolean, TType>
          : never;
      };
    };
  };
};

export type BuildStorageTables<
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >
  >,
> = {
  readonly [K in keyof Tables]: {
    readonly columns: {
      readonly [ColK in keyof ExtractColumns<Tables[K]>]: ExtractColumns<
        Tables[K]
      >[ColK] extends ColumnBuilderState<string, infer Null, infer TType>
        ? BuildStorageColumn<Null & boolean, TType>
        : never;
    };
  };
};

export type Mutable<T> = {
  -readonly [K in keyof T]-?: T[K];
};

export type BuildModelFields<Fields extends Record<string, string>> = {
  readonly [K in keyof Fields]: { readonly column: Fields[K] };
};

export type ExtractModelFields<
  T extends ModelBuilderState<
    string,
    string,
    Record<string, string>,
    Record<string, RelationDefinition>
  >,
> =
  T extends ModelBuilderState<string, string, infer F, Record<string, RelationDefinition>>
    ? F
    : never;

export type ExtractModelRelations<
  T extends ModelBuilderState<
    string,
    string,
    Record<string, string>,
    Record<string, RelationDefinition>
  >,
> = T extends ModelBuilderState<string, string, Record<string, string>, infer R> ? R : never;

export type BuildModels<
  Models extends Record<
    string,
    ModelBuilderState<string, string, Record<string, string>, Record<string, RelationDefinition>>
  >,
> = {
  readonly [K in keyof Models]: {
    readonly storage: { readonly table: Models[K]['table'] };
    readonly fields: BuildModelFields<ExtractModelFields<Models[K]>>;
  };
};

export type BuildRelations<
  Models extends Record<
    string,
    ModelBuilderState<string, string, Record<string, string>, Record<string, RelationDefinition>>
  >,
> = {
  readonly [K in keyof Models as Models[K]['table']]: ExtractModelRelations<Models[K]>;
};
