import {
  enumColumn,
  enumType,
  int4Column,
  textColumn,
} from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

/**
 * To-state for the enum-rebuild journey: the `status` enum drops the
 * `pending` value, leaving just `active` and `archived`. Removing an
 * enum value forces the Postgres `enumChangeCallStrategy` rebuild
 * recipe — `dataTransform(placeholder slots) → createEnumType(temp) →
 * alterColumnType` per dependent column → `dropEnumType(old) →
 * renameType(temp, old)` — so the user can remap any rows that still
 * carry the doomed value before the rebuild swap-over runs.
 */
export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  types: {
    status: enumType('status', ['active', 'archived']),
  },
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        status: field.column(enumColumn('status', 'status')),
      },
    }).sql({ table: 'user' }),
  },
});
