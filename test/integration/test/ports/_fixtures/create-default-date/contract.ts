import { int4Column, timestamptzColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

// Faithful translation of prisma/prisma functional suite `create-default-date`
// (postgres matrix entry).
//
// Original PSL (postgres provider):
//   model Visit {
//     id        Int      @id @default(autoincrement())
//     visitTime DateTime @default(now())
//   }
//
// `id` uses a PostgreSQL serial/identity column — its default is DB-generated,
// so it is optional in create input. `visitTime` uses `timestamptz` with a
// DB-side `now()` default. The DDL uses `serial primary key` so the sequence
// is auto-created; the contract column carries `defaultSql('now()')` to make
// visitTime optional in create input and to inform the contract of the
// DB-side default.
//
// Prisma does not snake_case field/model names: table = "Visit".

const Visit = model('Visit', {
  fields: {
    id: field.column(int4Column).id().defaultSql('nextval(\'"Visit_id_seq"\')'),
    visitTime: field.column(timestamptzColumn).defaultSql('now()'),
  },
}).sql({ table: 'Visit' });

export const contract = defineContract({
  models: { Visit },
});
