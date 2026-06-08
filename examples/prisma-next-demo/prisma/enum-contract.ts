import { textColumn } from '@prisma-next/adapter-postgres/column-types';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
} from '@prisma-next/postgres/contract-builder';

const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;

// A TS-authored enum (the `enumType` API, not a native PSL `enum`).
// Declaration order is low -> high -> urgent; lexical order differs, which is
// what the declaration-order `ORDER BY` surface sorts against.
export const Priority = enumType(
  'Priority',
  pgText,
  member('Low', 'low'),
  member('High', 'high'),
  member('Urgent', 'urgent'),
);

export const enumContract = defineContract({
  enums: { Priority },
  models: {
    Task: model('Task', {
      fields: {
        id: field.column(textColumn).id(),
        title: field.column(textColumn),
        priority: field.namedType(Priority),
      },
    }).sql({ table: 'enum_task' }),
  },
});

export type EnumContract = typeof enumContract;
