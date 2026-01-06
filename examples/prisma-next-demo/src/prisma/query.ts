import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import type { Contract } from './contract.d';
import { getContext } from './runtime';

// Lazy initialization helpers to defer DATABASE_URL requirement until first use
type SqlType = ReturnType<typeof sqlBuilder<Contract>>;
type OrmType = ReturnType<typeof ormBuilder<Contract>>;
type SchemaType = ReturnType<typeof schemaBuilder<Contract>>;

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

export const sql = createLazyProxy<SqlType>(() => {
  if (!_sql) {
    _sql = sqlBuilder<Contract>({ context: getContext() });
  }
  return _sql;
});

export const schema = createLazyProxy<SchemaType>(() => {
  if (!_schema) {
    _schema = schemaBuilder<Contract>(getContext());
  }
  return _schema;
});

export const tables = createLazyProxy<SchemaType['tables']>(() => {
  if (!_schema) {
    _schema = schemaBuilder<Contract>(getContext());
  }
  return _schema.tables;
});

export const orm = createLazyProxy<OrmType>(() => {
  if (!_orm) {
    _orm = ormBuilder<Contract>({ context: getContext() });
  }
  return _orm;
});
