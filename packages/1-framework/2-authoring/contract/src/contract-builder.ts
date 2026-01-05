import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import type {
  ColumnBuilderState,
  ContractBuilderState,
  EnumBuilderState,
  ModelBuilderState,
  RelationDefinition,
  TableBuilderState,
} from './builder-state';
import { ModelBuilder } from './model-builder';
import { TableBuilder } from './table-builder';

export class ContractBuilder<
  Target extends string | undefined = undefined,
  Tables extends Record<
    string,
    TableBuilderState<
      string,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >
  > = Record<never, never>,
  Models extends Record<
    string,
    ModelBuilderState<string, string, Record<string, string>, Record<string, RelationDefinition>>
  > = Record<never, never>,
  Enums extends Record<string, EnumBuilderState<string, readonly string[]>> = Record<never, never>,
  CoreHash extends string | undefined = undefined,
  ExtensionPacks extends Record<string, unknown> | undefined = undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
> {
  protected readonly state: ContractBuilderState<
    Target,
    Tables,
    Models,
    Enums,
    CoreHash,
    ExtensionPacks,
    Capabilities
  >;

  constructor(
    state?: ContractBuilderState<
      Target,
      Tables,
      Models,
      Enums,
      CoreHash,
      ExtensionPacks,
      Capabilities
    >,
  ) {
    this.state =
      state ??
      ({
        tables: {},
        models: {},
        enums: {},
      } as ContractBuilderState<
        Target,
        Tables,
        Models,
        Enums,
        CoreHash,
        ExtensionPacks,
        Capabilities
      >);
  }

  target<T extends string>(
    packRef: TargetPackRef<string, T>,
  ): ContractBuilder<T, Tables, Models, Enums, CoreHash, ExtensionPacks, Capabilities> {
    return new ContractBuilder<T, Tables, Models, Enums, CoreHash, ExtensionPacks, Capabilities>({
      ...this.state,
      target: packRef.targetId,
    });
  }

  capabilities<C extends Record<string, Record<string, boolean>>>(
    capabilities: C,
  ): ContractBuilder<Target, Tables, Models, Enums, CoreHash, ExtensionPacks, C> {
    return new ContractBuilder<Target, Tables, Models, Enums, CoreHash, ExtensionPacks, C>({
      ...this.state,
      capabilities,
    });
  }

  table<
    TableName extends string,
    T extends TableBuilder<
      TableName,
      Record<string, ColumnBuilderState<string, boolean, string>>,
      readonly string[] | undefined
    >,
  >(
    name: TableName,
    callback: (t: TableBuilder<TableName>) => T | undefined,
  ): ContractBuilder<
    Target,
    Tables & Record<TableName, ReturnType<T['build']>>,
    Models,
    Enums,
    CoreHash,
    ExtensionPacks,
    Capabilities
  > {
    const tableBuilder = new TableBuilder<TableName>({ name });
    const result = callback(tableBuilder);
    const finalBuilder = result instanceof TableBuilder ? result : tableBuilder;
    const tableState = finalBuilder.build();

    return new ContractBuilder<
      Target,
      Tables & Record<TableName, ReturnType<T['build']>>,
      Models,
      Enums,
      CoreHash,
      ExtensionPacks,
      Capabilities
    >({
      ...this.state,
      tables: { ...this.state.tables, [name]: tableState } as Tables &
        Record<TableName, ReturnType<T['build']>>,
    });
  }

  model<
    ModelName extends string,
    TableName extends string,
    M extends ModelBuilder<
      ModelName,
      TableName,
      Record<string, string>,
      Record<string, RelationDefinition>
    >,
  >(
    name: ModelName,
    table: TableName,
    callback: (
      m: ModelBuilder<ModelName, TableName, Record<string, string>, Record<never, never>>,
    ) => M | undefined,
  ): ContractBuilder<
    Target,
    Tables,
    Models & Record<ModelName, ReturnType<M['build']>>,
    Enums,
    CoreHash,
    ExtensionPacks,
    Capabilities
  > {
    const modelBuilder = new ModelBuilder<ModelName, TableName>(name, table);
    const result = callback(modelBuilder);
    const finalBuilder = result instanceof ModelBuilder ? result : modelBuilder;
    const modelState = finalBuilder.build();

    return new ContractBuilder<
      Target,
      Tables,
      Models & Record<ModelName, ReturnType<M['build']>>,
      Enums,
      CoreHash,
      ExtensionPacks,
      Capabilities
    >({
      ...this.state,
      models: { ...this.state.models, [name]: modelState } as Models &
        Record<ModelName, ReturnType<M['build']>>,
    });
  }

  /**
   * Define an enum type with ordered values.
   * @param name The name of the enum type (e.g., 'Role', 'Status')
   * @param values The ordered list of enum values (e.g., ['USER', 'ADMIN'])
   */
  enum<EnumName extends string, Values extends readonly [string, ...string[]]>(
    name: EnumName,
    values: Values,
  ): ContractBuilder<
    Target,
    Tables,
    Models,
    Enums & Record<EnumName, EnumBuilderState<EnumName, Values>>,
    CoreHash,
    ExtensionPacks,
    Capabilities
  > {
    const enumState: EnumBuilderState<EnumName, Values> = {
      name,
      values,
    };

    return new ContractBuilder<
      Target,
      Tables,
      Models,
      Enums & Record<EnumName, EnumBuilderState<EnumName, Values>>,
      CoreHash,
      ExtensionPacks,
      Capabilities
    >({
      ...this.state,
      enums: { ...this.state.enums, [name]: enumState } as Enums &
        Record<EnumName, EnumBuilderState<EnumName, Values>>,
    });
  }

  coreHash<H extends string>(
    hash: H,
  ): ContractBuilder<Target, Tables, Models, Enums, H, ExtensionPacks, Capabilities> {
    return new ContractBuilder<Target, Tables, Models, Enums, H, ExtensionPacks, Capabilities>({
      ...this.state,
      coreHash: hash,
    });
  }
}

export function defineContract(): ContractBuilder {
  return new ContractBuilder();
}
