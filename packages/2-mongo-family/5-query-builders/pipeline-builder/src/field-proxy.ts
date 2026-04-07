import { MongoAggFieldRef } from '@prisma-next/mongo-query-ast';
import type { DocField, DocShape, FieldProxy, TypedAggExpr } from './types';

export function createFieldProxy<S extends DocShape>(): FieldProxy<S> {
  return new Proxy({} as FieldProxy<S>, {
    get(_target, prop: string): TypedAggExpr<DocField> {
      return { _field: undefined as never, node: MongoAggFieldRef.of(prop) };
    },
  });
}
