import { Schema, buildRelationGraph } from '@prisma/relational-ir';
import { Table } from '@prisma/sql';
import { buildRelationHandles, RelationHandles, RelationHandle } from './handles';
import { OrmBuilder } from './builder';

export interface OrmFactory {
  from<T>(table: Table<T>): OrmBuilder<T>;
  [tableName: string]:
    | {
        [relationName: string]: RelationHandle;
      }
    | (<T>(table: Table<T>) => OrmBuilder<T>);
}

export function orm(ir: Schema): any {
  const graph = buildRelationGraph(ir);
  const handles = buildRelationHandles(ir, graph);

  return {
    ...handles, // r.user.posts, r.post.user
    from<T>(table: Table<T>): OrmBuilder<T> {
      return new OrmBuilder(table, ir, graph);
    },
  };
}
