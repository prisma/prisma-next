import { coreHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlMappings } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { expectTypeOf, test } from 'vitest';
import { schema } from '../src/schema';
import type { Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };
import { createTestContext } from './utils';

const contract = validateContract<Contract>(contractJson);
const context = createTestContext(contract);
const schemaHandle = schema(context);

// Contract type with storage.types using literal types (matching emission output)
type ContractWithTypes = SqlContract<
  {
    readonly tables: {
      readonly test: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
    };
    readonly types: {
      readonly Vector1536: {
        readonly codecId: 'pg/vector@1';
        readonly nativeType: 'vector';
        readonly typeParams: { readonly length: 1536 };
      };
      readonly Vector768: {
        readonly codecId: 'pg/vector@1';
        readonly nativeType: 'vector';
        readonly typeParams: { readonly length: 768 };
      };
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

// Create typed schema for contracts with storage.types
const contractWithTypes: ContractWithTypes = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: coreHash('sha256:test'),
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

// Module-level assignments to catch compile-time type errors
const vector1536Helper = typesSchema.types['Vector1536'];
const vector768Helper = typesSchema.types['Vector768'];

test('schema returns types property alongside tables', () => {
  // Verify schema returns both tables and types
  expectTypeOf(schemaHandle).toHaveProperty('tables');
  expectTypeOf(schemaHandle).toHaveProperty('types');

  // Verify types is an object, not undefined
  expectTypeOf(schemaHandle.types).toBeObject();
  expectTypeOf(typesSchema.types).toBeObject();
});

test('schema.types keys are literal union matching storage.types keys', () => {
  // Verify types has exactly the literal keys from storage.types
  type TypeKeys = keyof typeof typesSchema.types;

  // Should be exactly these keys, not a broader string type
  expectTypeOf<TypeKeys>().toEqualTypeOf<'Vector1536' | 'Vector768'>();

  // Verify it's NOT a string index signature (would be `string` instead of union)
  expectTypeOf<TypeKeys>().not.toEqualTypeOf<string>();
});

test('schema.types values preserve literal types from contract', () => {
  // Verify that accessing types by key returns the full literal type
  expectTypeOf(vector1536Helper).not.toBeNever();
  expectTypeOf(vector768Helper).not.toBeNever();

  // Verify the value has the expected structure with literal types
  expectTypeOf(vector1536Helper).toMatchTypeOf<{
    readonly codecId: 'pg/vector@1';
    readonly nativeType: 'vector';
    readonly typeParams: { readonly length: 1536 };
  }>();

  expectTypeOf(vector768Helper).toMatchTypeOf<{
    readonly codecId: 'pg/vector@1';
    readonly nativeType: 'vector';
    readonly typeParams: { readonly length: 768 };
  }>();

  // Verify typeParams.length is a literal number, not just `number`
  type Vector1536Length = typeof vector1536Helper.typeParams.length;
  expectTypeOf<Vector1536Length>().toEqualTypeOf<1536>();

  type Vector768Length = typeof vector768Helper.typeParams.length;
  expectTypeOf<Vector768Length>().toEqualTypeOf<768>();
});

test('schema.types is readonly', () => {
  // Verify the types object is readonly (immutable)
  expectTypeOf(typesSchema.types).toMatchTypeOf<
    Readonly<
      Record<
        string,
        {
          readonly codecId: string;
          readonly nativeType: string;
          readonly typeParams: Record<string, unknown>;
        }
      >
    >
  >();

  // This tests that we can't assign to the types object
  // (would be a compile error: Cannot assign to 'types' because it is a read-only property)
  type TypesIsReadonly =
    Readonly<typeof typesSchema.types> extends typeof typesSchema.types ? true : false;
  expectTypeOf<TypesIsReadonly>().toEqualTypeOf<true>();
});

test('schema.types has literal keys from the fixture contract', () => {
  // The fixture contract now has storage.types with Vector1536 and Vector768
  const types = schemaHandle.types;

  // Should be an object
  expectTypeOf(types).toBeObject();

  // Should have the literal keys from the contract
  type TypeKeys = keyof typeof types;
  expectTypeOf<TypeKeys>().toEqualTypeOf<'Vector1536' | 'Vector768'>();

  // Values should have the correct literal types
  expectTypeOf(types.Vector1536.typeParams.length).toEqualTypeOf<1536>();
  expectTypeOf(types.Vector768.typeParams.length).toEqualTypeOf<768>();
});

test('schema.types is generic record when contract does not specify types', () => {
  // Contract type without explicit storage.types - typing is generic
  type ContractWithoutTypes = SqlContract<
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
    },
    Record<string, never>,
    Record<string, never>,
    SqlMappings
  >;

  const noTypesContract: ContractWithoutTypes = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: coreHash('sha256:test'),
    storage: {
      tables: {
        test: {
          columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
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

  const noTypesContext = createTestContext(noTypesContract);
  const noTypesSchema = schema(noTypesContext);

  // types should still exist as an object
  expectTypeOf(noTypesSchema.types).toBeObject();

  // When storage.types is not explicitly specified in the contract type,
  // TypeScript infers a generic Record type, so keyof is `string`.
  // This is expected - to get specific literal keys, the contract must
  // explicitly declare the types.
  type GenericTypeKeys = keyof typeof noTypesSchema.types;
  expectTypeOf<GenericTypeKeys>().toEqualTypeOf<string>();
});

test('schemaHandle is frozen (readonly)', () => {
  // Verify the entire schema handle is readonly
  expectTypeOf(schemaHandle).toMatchTypeOf<{
    readonly tables: unknown;
    readonly types: unknown;
  }>();

  expectTypeOf(typesSchema).toMatchTypeOf<{
    readonly tables: unknown;
    readonly types: unknown;
  }>();
});

test('schema.types preserves type information through schema() call', () => {
  // Create a fresh schema to verify types flow through correctly
  const freshContext = createTestContext(contractWithTypes);
  const freshSchema = schema(freshContext);

  // Keys should still be preserved as literals after passing through schema()
  type FreshTypeKeys = keyof typeof freshSchema.types;
  expectTypeOf<FreshTypeKeys>().toEqualTypeOf<'Vector1536' | 'Vector768'>();

  // Values should be accessible
  const v1536 = freshSchema.types['Vector1536'];
  expectTypeOf(v1536).not.toBeNever();
});
