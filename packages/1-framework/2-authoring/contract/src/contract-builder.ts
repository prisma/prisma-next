import type {
  ColumnBuilderState,
  ContractBuilderState,
  ModelBuilderState,
  RelationDefinition,
  TableBuilderState,
} from './builder-state';
import { ModelBuilder } from './model-builder';
import { TableBuilder } from './table-builder';

/**
 * Minimal pack ref interface for target selection.
 * Family-specific builders can use more specific pack ref types.
 */
export interface TargetPackRefLike<T extends string = string> {
  readonly targetId: T;
}

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
  Extensions extends Record<string, unknown> | undefined = undefined,
  Capabilities extends Record<string, Record<string, boolean>> | undefined = undefined,
> {
  protected readonly state: ContractBuilderState<
    Target,
    Tables,
    Models,
    CoreHash,
    Extensions,
    Capabilities
  >;

  constructor(
    state?: ContractBuilderState<Target, Tables, Models, CoreHash, Extensions, Capabilities>,
  ) {
    this.state =
      state ??
      ({
        tables: {},
        models: {},
      } as ContractBuilderState<Target, Tables, Models, CoreHash, Extensions, Capabilities>);
  }

  target<T extends string>(
    targetOrPackRef: T | TargetPackRefLike<T>,
  ): ContractBuilder<T, Tables, Models, CoreHash, Extensions, Capabilities> {
    const targetId =
      typeof targetOrPackRef === 'string' ? targetOrPackRef : targetOrPackRef.targetId;
    return new ContractBuilder<T, Tables, Models, CoreHash, Extensions, Capabilities>({
      ...this.state,
      target: targetId,
    });
  }

  capabilities<C extends Record<string, Record<string, boolean>>>(
    capabilities: C,
  ): ContractBuilder<Target, Tables, Models, CoreHash, Extensions, C> {
    return new ContractBuilder<Target, Tables, Models, CoreHash, Extensions, C>({
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
    Extensions,
    Capabilities
  > {
    const tableBuilder = new TableBuilder<TableName>(name);
    const result = callback(tableBuilder);
    const finalBuilder = result instanceof TableBuilder ? result : tableBuilder;
    const tableState = finalBuilder.build();

    return new ContractBuilder<
      Target,
      Tables & Record<TableName, ReturnType<T['build']>>,
      Models,
      CoreHash,
      Extensions,
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
    CoreHash,
    Extensions,
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
      CoreHash,
      Extensions,
      Capabilities
    >({
      ...this.state,
      models: { ...this.state.models, [name]: modelState } as Models &
        Record<ModelName, ReturnType<M['build']>>,
    });
  }

  coreHash<H extends string>(
    hash: H,
  ): ContractBuilder<Target, Tables, Models, H, Extensions, Capabilities> {
    return new ContractBuilder<Target, Tables, Models, H, Extensions, Capabilities>({
      ...this.state,
      coreHash: hash,
    });
  }
}

export function defineContract(): ContractBuilder {
  return new ContractBuilder();
}
