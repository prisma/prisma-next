import type {
  SqlContract,
  SqlMappings,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { expectTypeOf, test } from 'vitest';
import { schema } from '../src/schema';
import type { Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };
import { createTestContext } from './utils';

const contract = validateContract<Contract>(contractJson);
const context = createTestContext(contract);
const schemaHandle = schema(context);

// Contract type with storage.types for testing schema.types
type ContractWithTypes = SqlContract<
  {
    readonly tables: {
      readonly test: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            nullable: false;
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
    };
    readonly types: {
      readonly Vector1536: StorageTypeInstance;
      readonly Vector768: StorageTypeInstance;
    };
  },
  Record<string, never>,
  Record<string, never>,
  SqlMappings
>;

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
  expectTypeOf<ColumnKeys>().toEqualTypeOf<'id' | 'email' | 'createdAt'>();
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

// =============================================================================
// schema.types type tests
// =============================================================================

test('schema returns types property', () => {
  // Verify schema returns types object
  expectTypeOf(schemaHandle).toHaveProperty('types');
  expectTypeOf(schemaHandle.types).toBeObject();
});

test('schema.types has literal keys from contract storage.types', () => {
  // Create a contract with storage.types
  const contractWithTypes: ContractWithTypes = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test',
    storage: {
      tables: {
        test: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      types: {
        Vector1536: {
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
        Vector768: {
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: { length: 768 },
        },
      },
    },
    models: {},
    relations: {},
    mappings: { codecTypes: {}, operationTypes: {} },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
  };

  const typesContext = createTestContext(contractWithTypes);
  const typesSchema = schema(typesContext);

  // Verify types has literal keys matching storage.types
  type TypeKeys = keyof typeof typesSchema.types;
  expectTypeOf<TypeKeys>().toEqualTypeOf<'Vector1536' | 'Vector768'>();

  // Verify type helpers can be accessed with dot notation
  expectTypeOf(typesSchema.types).toHaveProperty('Vector1536');
  expectTypeOf(typesSchema.types).toHaveProperty('Vector768');
});

test('schema.types is accessible when contract has no storage.types', () => {
  // The current contract has no storage.types, but schema.types should still be accessible
  // as an empty record type
  const types = schemaHandle.types;
  expectTypeOf(types).toBeObject();
});
