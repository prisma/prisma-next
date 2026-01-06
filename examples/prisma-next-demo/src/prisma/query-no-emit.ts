import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import type { contract } from '../../prisma/contract';
import { getContext } from './runtime-no-emit';

// Lazy initialization helpers to defer DATABASE_URL requirement until first use
type SqlType = ReturnType<typeof sqlBuilder<typeof contract>>;
type OrmType = ReturnType<typeof ormBuilder<typeof contract>>;
type SchemaType = ReturnType<typeof schemaBuilder<typeof contract>>;

let _sql: SqlType | undefined;
let _orm: OrmType | undefined;
let _schema: SchemaType | undefined;

function createLazyProxy<T extends object>(getInstance: () => T): T {
  return new Proxy({} as T, {
    get(_, prop) {
      return Reflect.get(getInstance(), prop);
    },
  });
}

// Use contract directly from TypeScript - no emit needed!
export const sql = createLazyProxy<SqlType>(() => {
  if (!_sql) {
    _sql = sqlBuilder<typeof contract>({ context: getContext() });
  }
  return _sql;
});

export const schema = createLazyProxy<SchemaType>(() => {
  if (!_schema) {
    _schema = schemaBuilder<typeof contract>(getContext());
  }
  return _schema;
});

export const tables = createLazyProxy<SchemaType['tables']>(() => {
  if (!_schema) {
    _schema = schemaBuilder<typeof contract>(getContext());
  }
  return _schema.tables;
});

export const orm = createLazyProxy<OrmType>(() => {
  if (!_orm) {
    _orm = ormBuilder<typeof contract>({ context: getContext() });
  }
  return _orm;
});
