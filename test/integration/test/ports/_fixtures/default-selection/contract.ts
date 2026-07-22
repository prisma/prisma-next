import { textColumn } from '@prisma-next/adapter-postgres/column-types';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
  rel,
} from '@prisma-next/postgres/contract-builder';

// Faithful translation of prisma/prisma functional suite `default-selection`
// (postgres matrix entry).
//
// Original PSL (postgres provider):
//   model Model {
//     id       String @id @default(cuid())
//     value    String
//     otherId  String @unique
//     relation Other  @relation(fields: [otherId], references: [id])
//     list     String[]    // postgres-only
//     enum     Enum        // non-sqlite/sqlserver
//     enumList Enum[]      // non-mysql, non-sqlite/sqlserver
//   }
//   model Other { id String @id; model Model? }
//   enum Enum { A; B }
//
// `String[]` (list) and `Enum[]` (enumList) are unsupported by the TS
// contract builder — there is no array-column type in the DSL. Those two
// fields are omitted; the four tests that ONLY inspect id/value/otherId
// and the non-array enum field can still be ported faithfully.
//
// Prisma does NOT snake_case field/model names, so table = "Model",
// columns = "id"/"value"/"otherId" (no mapping needed).

const Enum = enumType('Enum', textColumn, member('A', 'A'), member('B', 'B'));

const OtherBase = model('Other', {
  fields: {
    id: field.column(textColumn).id(),
  },
}).sql({ table: 'Other' });

const ModelBase = model('Model', {
  fields: {
    id: field.column(textColumn).id(),
    value: field.column(textColumn),
    otherId: field.column(textColumn).unique(),
    enum: field.namedType(Enum),
  },
}).sql({ table: 'Model' });

const Other = OtherBase.relations({
  model: rel.hasOne(() => ModelBase, { by: 'otherId' }),
});

const ModelModel = ModelBase.relations({
  relation: rel.belongsTo(OtherBase, { from: 'otherId', to: 'id' }).sql({ fk: {} }),
});

export const contract = defineContract({
  models: { Model: ModelModel, Other },
  enums: { Enum },
});
