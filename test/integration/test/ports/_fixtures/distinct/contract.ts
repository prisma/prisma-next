import { textColumn } from '@prisma-next/adapter-postgres/column-types';
import { defineContract, field, model } from '@prisma-next/postgres/contract-builder';

// Faithful translation of prisma/prisma functional suite `distinct`:
//   model User {
//     id        String @id @default(cuid())
//     firstName String
//     lastName  String
//   }
// Prisma maps model/field names to table/column names verbatim (no snake_case),
// so the table is "User" with columns "id" / "firstName" / "lastName". The cuid
// default is irrelevant to the distinct semantics under test; rows are seeded
// with explicit ids.
const User = model('User', {
  fields: {
    id: field.column(textColumn).id(),
    firstName: field.column(textColumn),
    lastName: field.column(textColumn),
  },
}).sql({ table: 'User' });

export const contract = defineContract({
  models: { User },
});
