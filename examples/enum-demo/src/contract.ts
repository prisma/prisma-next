import sqlFamilyPack from '@prisma-next/family-sql/pack';
import {
  buildBoundContract,
  enumType,
  member,
} from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' };

// Declaration order is low -> high -> medium. Lexical order (high, low, medium)
// differs, which is what the ORDER BY surface sorts against.
export const Priority = enumType(
  'Priority',
  pgText,
  member('Low', 'low'),
  member('High', 'high'),
  member('Medium', 'medium'),
);

export const contract = buildBoundContract(
  sqlFamilyPack,
  postgresPack,
  { enums: { Priority } },
  ({ field: f, model: m }) => ({
    models: {
      Task: m('Task', {
        fields: {
          id: f.text().id(),
          title: f.text(),
          priority: f.namedType(Priority),
        },
      }).sql({ table: 'task' }),
    },
  }),
);

export type Contract = typeof contract;
