import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import type {
  ColumnBuilderState,
  ContractBuilderState,
  ModelBuilderState,
  RelationDefinition,
  TableBuilderState,
} from './builder-state';
import { ModelBuilder } from './model-builder';
import { createTable, TableBuilder } from './table-builder';

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
  CoreHash extends string | undefined = undefined,
  ExtensionPacks extends Record<string, unknown> | undefined = undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
  Enums extends Record<string, readonly string[]> = Record<never, never>,
> {
  protected readonly state: ContractBuilderState<
    Target,
    Tables,
    Models,
    CoreHash,
    ExtensionPacks,
    Capabilities,
    Enums
  >;

  constructor(
    state?: ContractBuilderState<
      Target,
      Tables,
      Models,
      CoreHash,
      ExtensionPacks,
      Capabilities,
      Enums
    >,
  ) {
    this.state =
      state ??
      ({
        tables: {},
        models: {},
      } as ContractBuilderState<
        Target,
        Tables,
        Models,
        CoreHash,
        ExtensionPacks,
        Capabilities,
        Enums
      >);
  }

  target<T extends string>(
    packRef: TargetPackRef<string, T>,
  ): ContractBuilder<T, Tables, Models, CoreHash, ExtensionPacks, Capabilities, Enums> {
    return new ContractBuilder<T, Tables, Models, CoreHash, ExtensionPacks, Capabilities, Enums>({
      ...this.state,
      target: packRef.targetId,
    });
  }

  capabilities<C extends Record<string, Record<string, boolean>>>(
    capabilities: C,
  ): ContractBuilder<Target, Tables, Models, CoreHash, ExtensionPacks, C, Enums> {
    return new ContractBuilder<Target, Tables, Models, CoreHash, ExtensionPacks, C, Enums>({
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
    CoreHash,
    ExtensionPacks,
    Capabilities,
    Enums
  > {
    const tableBuilder = createTable(name);
    const result = callback(tableBuilder);
    const finalBuilder = result instanceof TableBuilder ? result : tableBuilder;
    const tableState = finalBuilder.build();

    return new ContractBuilder<
      Target,
      Tables & Record<TableName, ReturnType<T['build']>>,
      Models,
      CoreHash,
      ExtensionPacks,
      Capabilities,
      Enums
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
    CoreHash,
    ExtensionPacks,
    Capabilities,
    Enums
  > {
    const modelBuilder = new ModelBuilder<ModelName, TableName>(name, table);
    const result = callback(modelBuilder);
    const finalBuilder = result instanceof ModelBuilder ? result : modelBuilder;
    const modelState = finalBuilder.build();

    return new ContractBuilder<
      Target,
      Tables,
      Models & Record<ModelName, ReturnType<M['build']>>,
      CoreHash,
      ExtensionPacks,
      Capabilities,
      Enums
    >({
      ...this.state,
      models: { ...this.state.models, [name]: modelState } as Models &
        Record<ModelName, ReturnType<M['build']>>,
    });
  }

  coreHash<H extends string>(
    hash: H,
  ): ContractBuilder<Target, Tables, Models, H, ExtensionPacks, Capabilities, Enums> {
    return new ContractBuilder<Target, Tables, Models, H, ExtensionPacks, Capabilities, Enums>({
      ...this.state,
      coreHash: hash,
    });
  }
}

export function defineContract(): ContractBuilder {
  return new ContractBuilder();
}
