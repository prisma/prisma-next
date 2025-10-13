import { Schema, buildRelationGraph, Contract } from '@prisma/relational-ir';
import { Table } from '@prisma/sql';
import { buildRelationHandles, RelationHandles, RelationHandle } from './handles';
import { OrmBuilder } from './builder';
import { TypedOrmBuilder, TypedOrmFactory } from '../typed-builder';

export interface OrmFactory {
  from<T>(table: Table<T>): OrmBuilder<T>;
  [tableName: string]:
    | {
        [relationName: string]: RelationHandle;
      }
    | (<T>(table: Table<T>) => OrmBuilder<T>);
}

export function orm<TContract extends Contract>(ir: Schema): TypedOrmFactory<TContract> {
  const graph = buildRelationGraph(ir);
  const handles = buildRelationHandles(ir, graph);

  // Cast the runtime handles to the typed version
  const typedHandles = handles as any as {
    [P in keyof TContract['Relations'] & string]: {
      [K in keyof TContract['Relations'][P] & string]: any;
    };
  };

  return {
    ...typedHandles, // Spread all relation handles
    from<TParent extends keyof TContract['Tables'] & string>(
      table: Table<any>,
    ): TypedOrmBuilder<TContract, TParent> {
      return new TypedOrmBuilder(table, ir, graph);
    },
  } as any as TypedOrmFactory<TContract>;
}
