import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { expectTypeOf, test } from 'vitest';
import { schema } from '../src/schema';
import type { Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };
import { createTestContext } from './utils';

const contract = validateContract<Contract>(contractJson);
const context = createTestContext(contract);
const schemaHandle = schema(context);

// These assignments MUST be at module level (not inside test blocks)
// to trigger compile-time type checking. If these fail, the type tests will fail to compile.
// This ensures we catch index signature issues at compile time, not just at runtime.
const userTable = schemaHandle.tables.user;
const idColumn = userTable.columns.id;
const emailColumn = userTable.columns.email;
const createdAtColumn = userTable.columns.createdAt;

// Type-level checks that should fail if index signatures exist
type TableKeys = keyof typeof schemaHandle.tables;
type ColumnKeys = keyof typeof userTable.columns;

test('schema tables have literal keys, not index signatures', () => {
  // Verify that tables can be accessed with dot notation (not bracket notation)
  // This test will fail to compile if tables has an index signature
  // The assignments above will trigger TypeScript errors if dot notation is not allowed
  expectTypeOf(userTable).not.toBeUndefined();

  // Verify table keys are literal types, not string
  expectTypeOf<TableKeys>().toEqualTypeOf<'user'>();

  // Verify that accessing with bracket notation is not required
  // (If index signature existed, TypeScript would require bracket notation)
  expectTypeOf(userTable).not.toBeUndefined();
});

test('table columns have literal keys, not index signatures', () => {
  // Verify columns can be accessed with dot notation
  // The assignments at module level will fail to compile if index signatures exist
  expectTypeOf(idColumn).not.toBeUndefined();
  expectTypeOf(emailColumn).not.toBeUndefined();
  expectTypeOf(createdAtColumn).not.toBeUndefined();

  // Verify column keys are literal types
  expectTypeOf<ColumnKeys>().toEqualTypeOf<'id' | 'email' | 'createdAt' | 'role' | 'status'>();
});

test('schema returns correct SchemaHandle type', () => {
  // Verify the schema function returns the correct type
  expectTypeOf(schemaHandle).toHaveProperty('tables');
  expectTypeOf(schemaHandle.tables).toHaveProperty('user');
});

test('schema works with inferred contract type', () => {
  // Test that schema works when Contract type is inferred from the contract object
  const inferredContext = createTestContext(contract);
  const inferredSchema = schema(inferredContext);

  // Should still have literal keys
  type InferredTableKeys = keyof typeof inferredSchema.tables;
  expectTypeOf<InferredTableKeys>().toEqualTypeOf<'user'>();

  // Should allow dot notation access
  const _userTable = inferredSchema.tables.user;
  expectTypeOf(_userTable).not.toBeUndefined();
});

test('schema extracts CodecTypes automatically from contract', () => {
  // Test that schema automatically extracts CodecTypes from contract
  const schemaHandle = schema(context);

  // Should still work correctly
  expectTypeOf(schemaHandle.tables).toHaveProperty('user');
  expectTypeOf(schemaHandle.tables.user.columns).toHaveProperty('id');
});

// Enum access at module level for compile-time checking
const roleEnum = schemaHandle.enums.role;

test('schema exposes enums with literal keys', () => {
  // Verify enums can be accessed with dot notation
  expectTypeOf(schemaHandle).toHaveProperty('enums');
  expectTypeOf(schemaHandle.enums).toHaveProperty('role');

  // Verify enum keys are literal types
  type EnumKeys = keyof typeof schemaHandle.enums;
  expectTypeOf<EnumKeys>().toEqualTypeOf<'role' | 'status'>();
});

test('enum has name and values properties with correct types', () => {
  // Verify the role enum has the correct structure
  expectTypeOf(roleEnum).toHaveProperty('name');
  expectTypeOf(roleEnum).toHaveProperty('values');

  // Verify the name is the literal type
  expectTypeOf(roleEnum.name).toEqualTypeOf<'role'>();

  // Verify values are the literal tuple of enum values
  expectTypeOf(roleEnum.values).toEqualTypeOf<readonly ['USER', 'ADMIN']>();
});

test('enum exposes individual values as typed properties', () => {
  // Verify individual enum values are accessible as properties
  expectTypeOf(roleEnum).toHaveProperty('USER');
  expectTypeOf(roleEnum).toHaveProperty('ADMIN');

  // Verify each value property has the correct literal type
  expectTypeOf(roleEnum.USER).toEqualTypeOf<'USER'>();
  expectTypeOf(roleEnum.ADMIN).toEqualTypeOf<'ADMIN'>();
});
