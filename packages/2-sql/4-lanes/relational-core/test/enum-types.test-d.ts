import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { assertType, expectTypeOf, test } from 'vitest';
import { schema } from '../src/schema';
import type { Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };
import { createTestContext } from './utils';

const contract = validateContract<Contract>(contractJson);
const context = createTestContext(contract);
const schemaHandle = schema(context);

// Assign at module level for compile-time type checking
const userTable = schemaHandle.tables.user;
const roleColumn = userTable.columns.role;
const statusColumn = userTable.columns.status;

test('enum column infers union type from contract.storage.enums', () => {
  // role is non-nullable, should be 'USER' | 'ADMIN' | 'MODERATOR'
  type RoleType = typeof roleColumn.__jsType;
  expectTypeOf<RoleType>().toEqualTypeOf<'USER' | 'ADMIN' | 'MODERATOR'>();

  // Verify it's not just 'string'
  assertType<'USER' | 'ADMIN' | 'MODERATOR'>(roleColumn.__jsType);
});

test('nullable enum column infers union type | null', () => {
  // status is nullable, should be 'ACTIVE' | 'INACTIVE' | 'PENDING' | null
  type StatusType = typeof statusColumn.__jsType;
  expectTypeOf<StatusType>().toEqualTypeOf<'ACTIVE' | 'INACTIVE' | 'PENDING' | null>();
});

test('enum columns can be accessed with dot notation', () => {
  // Ensure columns are accessible
  expectTypeOf(roleColumn).not.toBeUndefined();
  expectTypeOf(statusColumn).not.toBeUndefined();

  // Verify they are ColumnBuilder types
  expectTypeOf(roleColumn).toHaveProperty('eq');
  expectTypeOf(statusColumn).toHaveProperty('eq');
});

test('non-enum columns still use codec-based type inference', () => {
  const idColumn = userTable.columns.id;
  const emailColumn = userTable.columns.email;

  // id should be number (from pg/int4@1 codec)
  type IdType = typeof idColumn.__jsType;
  expectTypeOf<IdType>().toEqualTypeOf<number>();

  // email should be string (from pg/text@1 codec)
  type EmailType = typeof emailColumn.__jsType;
  expectTypeOf<EmailType>().toEqualTypeOf<string>();
});
