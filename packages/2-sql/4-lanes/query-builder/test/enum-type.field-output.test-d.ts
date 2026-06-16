import type { StorageHashBase } from '@prisma-next/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@prisma-next/sql-contract/types';
import { assertType, expectTypeOf, test } from 'vitest';
import type { ExtractOutputType, TableToSelection } from '../src/selection';

// ---------------------------------------------------------------------------
// Minimal enum-typed contract fixture for query-builder lane.
//
// The query surface types a column by indexing the storage lookup
// `StorageColumnTypes[ns][table][column]` (output) directly — no cross-plane
// model→field walk. So the value union and codec output both come from the
// storage maps below. A raw value-set column (`audit_action`) with no domain
// field still types correctly because the storage lookup does not require a
// model field to exist.
// ---------------------------------------------------------------------------

type EnumCodecTypes = {
  'pg/text@1': {
    output: string;
    input: string;
    traits: 'equality' | 'order' | 'textual';
  };
};

type EnumFieldOutputTypes = {
  User: {
    role: 'user' | 'admin';
    status: 'active' | 'inactive' | null;
  };
};

type EnumStorageColumnTypes = {
  __unbound__: {
    User: {
      role: 'user' | 'admin';
      status: 'active' | 'inactive' | null;
      // A storage column with a value-set but no domain field.
      audit_action: 'create' | 'update' | 'delete';
      // A plain (non-enum) column resolves to the codec output.
      name: string;
    };
  };
};

type EnumStorageColumnInputTypes = {
  __unbound__: {
    User: {
      role: 'user' | 'admin';
      status: 'active' | 'inactive' | null;
      audit_action: 'create' | 'update' | 'delete';
      name: string;
    };
  };
};

type EnumTypeMaps = TypeMaps<
  EnumCodecTypes,
  Record<string, never>,
  EnumFieldOutputTypes,
  Record<string, never>,
  EnumStorageColumnTypes,
  EnumStorageColumnInputTypes
>;

type EnumStorage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    __unbound__: {
      id: '__unbound__';
      kind: 'sql-namespace';
      entries: {
        table: {
          User: {
            columns: {
              role: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              status: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: true };
              audit_action: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              name: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
            };
            primaryKey: { columns: ['role'] };
            uniques: [];
            indexes: [];
            foreignKeys: [];
          };
        };
      };
    };
  };
};

type EnumModels = {
  User: {
    storage: {
      table: 'User';
      fields: {
        role: { column: 'role' };
        status: { column: 'status' };
        name: { column: 'name' };
      };
    };
    fields: {
      role: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
      status: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: true;
      };
      name: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
    };
    relations: Record<string, never>;
  };
};

// A plain structural base (not derived from `Contract<…>` via `Omit`): the
// phantom `TypeMaps` key survives reliably on a plain object intersection, so
// `ExtractStorageColumnTypes` resolves. (`ExtractOutputType` only needs the
// storage namespaces — for `UnboundTables` — plus the phantom.) This matches
// `Contract<SqlStorage>` structurally for the fields the lane reads.
type EnumContractBase = {
  readonly target: 'postgres';
  readonly targetFamily: 'sql';
  readonly roots: Record<string, never>;
  readonly storage: EnumStorage;
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: EnumModels };
    };
  };
  readonly capabilities: Record<string, never>;
  readonly extensionPacks: Record<string, never>;
  readonly meta: Record<string, never>;
  readonly profileHash: StorageHashBase<string>;
};

type EnumContract = ContractWithTypeMaps<EnumContractBase, EnumTypeMaps>;

// ---------------------------------------------------------------------------
// Read output: ExtractOutputType reads StorageColumnTypes[ns][table][column].
// ---------------------------------------------------------------------------

test('query-builder: non-nullable enum column output is value union, not string', () => {
  type RoleOutput = ExtractOutputType<EnumContract, 'User', 'role'>;
  assertType<RoleOutput>('user');
  expectTypeOf<RoleOutput>().toEqualTypeOf<'user' | 'admin'>();
});

test('query-builder: non-nullable enum column output is not bare string', () => {
  type RoleOutput = ExtractOutputType<EnumContract, 'User', 'role'>;
  expectTypeOf<RoleOutput>().not.toEqualTypeOf<string>();
});

test('query-builder: nullable enum column output is value union | null', () => {
  type StatusOutput = ExtractOutputType<EnumContract, 'User', 'status'>;
  expectTypeOf<StatusOutput>().toEqualTypeOf<'active' | 'inactive' | null>();
});

test('query-builder: raw value-set column with no domain field still types as the union (A3)', () => {
  type AuditOutput = ExtractOutputType<EnumContract, 'User', 'audit_action'>;
  assertType<AuditOutput>('create');
  expectTypeOf<AuditOutput>().toEqualTypeOf<'create' | 'update' | 'delete'>();
  expectTypeOf<AuditOutput>().not.toEqualTypeOf<string>();
});

test('query-builder: plain non-enum column output is the codec output', () => {
  type NameOutput = ExtractOutputType<EnumContract, 'User', 'name'>;
  assertType<NameOutput>('any string');
  expectTypeOf<NameOutput>().toEqualTypeOf<string>();
});

test('query-builder: TableToSelection includes enum value union for role column', () => {
  type Selection = TableToSelection<EnumContract, 'User'>;
  type RoleValue = Selection['role']['~output'];
  expectTypeOf<RoleValue>().toEqualTypeOf<'user' | 'admin'>();
});
