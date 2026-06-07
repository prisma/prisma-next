import type { Contract } from '@prisma-next/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';

// ---------------------------------------------------------------------------
// Minimal pack stubs (no postgres target needed — codec is passed explicitly)
// ---------------------------------------------------------------------------

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: { codecId: 'pg/text@1', nativeType: 'text' },
      },
    },
  },
} as const satisfies FamilyPackRef<'sql'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

// A minimal codec descriptor that carries the codecId + nativeType the
// `enumType` API requires — same shape as a FieldPreset output / ColumnTypeDescriptor.
const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;

// ---------------------------------------------------------------------------
// member()
// ---------------------------------------------------------------------------

describe('member()', () => {
  it('preserves name and value as literal types', () => {
    const m = member('User', 'user');
    expectTypeOf(m.name).toEqualTypeOf<'User'>();
    expectTypeOf(m.value).toEqualTypeOf<'user'>();
  });

  it('defaults value to name when omitted', () => {
    const m = member('Admin');
    expect(m.value).toBe('Admin');
    expectTypeOf(m.value).toEqualTypeOf<'Admin'>();
  });

  it('returns correct runtime values', () => {
    const m = member('User', 'user');
    expect(m).toEqual({ name: 'User', value: 'user' });
  });
});

// ---------------------------------------------------------------------------
// enumType() — static shape
// ---------------------------------------------------------------------------

describe('enumType() — static type preservation', () => {
  const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

  it('preserves literal value tuple on .values', () => {
    expectTypeOf(Role.values).toEqualTypeOf<readonly ['user', 'admin']>();
  });

  it('preserves literal name tuple on .names', () => {
    expectTypeOf(Role.names).toEqualTypeOf<readonly ['User', 'Admin']>();
  });

  it('.members accessor returns literals', () => {
    expectTypeOf(Role.members.User).toEqualTypeOf<'user'>();
    expectTypeOf(Role.members.Admin).toEqualTypeOf<'admin'>();
  });

  it('invalid member access is a type error', () => {
    // @ts-expect-error — 'Guest' is not a member of Role
    Role.members.Guest;
  });
});

// ---------------------------------------------------------------------------
// enumType() — runtime behaviour
// ---------------------------------------------------------------------------

describe('enumType() — runtime behaviour', () => {
  const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

  it('exposes correct runtime .values', () => {
    expect(Role.values).toEqual(['user', 'admin']);
  });

  it('exposes correct runtime .names', () => {
    expect(Role.names).toEqual(['User', 'Admin']);
  });

  it('exposes correct .members accessor', () => {
    expect(Role.members.User).toBe('user');
    expect(Role.members.Admin).toBe('admin');
  });

  it('.has() returns true for valid values', () => {
    expect(Role.has('user')).toBe(true);
    expect(Role.has('admin')).toBe(true);
  });

  it('.has() returns false for unknown values', () => {
    expect(Role.has('guest')).toBe(false);
  });

  it('.nameOf() returns the name for a valid value', () => {
    expect(Role.nameOf('user')).toBe('User');
    expect(Role.nameOf('admin')).toBe('Admin');
  });

  it('.nameOf() returns undefined for an unknown value', () => {
    expect(Role.nameOf('guest')).toBeUndefined();
  });

  it('.ordinalOf() returns the zero-based index', () => {
    expect(Role.ordinalOf('user')).toBe(0);
    expect(Role.ordinalOf('admin')).toBe(1);
  });

  it('.ordinalOf() returns -1 for an unknown value', () => {
    expect(Role.ordinalOf('guest')).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// enumType() — well-formedness guards
// ---------------------------------------------------------------------------

describe('enumType() — well-formedness guards', () => {
  it('throws on empty member list', () => {
    expect(() => enumType('Empty', pgText)).toThrow(/at least one member/i);
  });

  it('throws on duplicate names', () => {
    expect(() => enumType('Dupe', pgText, member('User', 'user'), member('User', 'user2'))).toThrow(
      /duplicate.*name/i,
    );
  });

  it('throws on duplicate values', () => {
    expect(() => enumType('Dupe', pgText, member('User', 'same'), member('Admin', 'same'))).toThrow(
      /duplicate.*value/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Authoring → structure
//
// The `SqlContractResult` type used by `defineContract` narrows the
// storage namespace entries to `{ table: ... }` and domain fields to
// `{ nullable, type }` for DSL inference purposes. Tests that verify
// `valueSet` / `enum` wiring access the contract as `Contract<SqlStorage>`
// so the full IR types are visible.
// ---------------------------------------------------------------------------

describe('enumType() authoring → contract structure', () => {
  const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));

  it('emits domain enum entry', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      enums: { Role },
      models: {},
    }) as Contract<SqlStorage>;

    const domainNs = contract.domain.namespaces['public'];
    expect(domainNs?.enum?.['Role']).toEqual({
      codecId: 'pg/text@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    });
  });

  it('emits storage valueSet entry', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      enums: { Role },
      models: {},
    }) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const valueSet = storageNs?.entries.valueSet?.['Role'];
    expect(valueSet).toBeDefined();
    expect(valueSet?.values).toEqual(['user', 'admin']);
  });

  it('field.namedType(handle) sets valueSet on domain field', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      enums: { Role },
      models: {
        User: model('User', {
          fields: {
            role: field.namedType(Role),
          },
        }),
      },
    }) as Contract<SqlStorage>;

    const domainNs = contract.domain.namespaces['public'];
    const userModel = domainNs?.models?.['User'];
    const roleField = userModel?.fields?.['role'];
    expect(roleField?.valueSet).toEqual({
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: 'public',
      name: 'Role',
    });
  });

  it('field.namedType(handle) sets valueSet on storage column', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      enums: { Role },
      models: {
        User: model('User', {
          fields: {
            role: field.namedType(Role),
          },
        }),
      },
    }) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const userTable = storageNs?.entries.table?.['User'];
    const roleColumn = userTable?.columns?.['role'];
    expect(roleColumn?.valueSet).toEqual({
      plane: 'storage',
      entityKind: 'value-set',
      namespaceId: 'public',
      name: 'Role',
    });
  });

  it('field.namedType(handle) does not set typeRef on storage column', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      enums: { Role },
      models: {
        User: model('User', {
          fields: {
            role: field.namedType(Role),
          },
        }),
      },
    }) as Contract<SqlStorage>;

    const storageNs = contract.storage.namespaces['public'];
    const userTable = storageNs?.entries.table?.['User'];
    const roleColumn = userTable?.columns?.['role'];
    expect(roleColumn?.typeRef).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Full integration with model builder DSL
// ---------------------------------------------------------------------------

describe('enumType() — full integration via defineContract factory', () => {
  it('produces correct domain + storage structure when field uses namedType', () => {
    const Status = enumType(
      'Status',
      pgText,
      member('Active', 'active'),
      member('Inactive', 'inactive'),
    );

    const contract = defineContract(
      {
        family: sqlFamilyPack,
        target: postgresTargetPack,
        enums: { Status },
      },
      ({ field: f, model: m }) =>
        ({
          models: {
            Post: m('Post', {
              fields: {
                id: f.text().id(),
                status: f.namedType(Status),
              },
            }),
          },
        }) as const,
    ) as Contract<SqlStorage>;

    // domain enum
    const domainNs = contract.domain.namespaces['public'];
    expect(domainNs?.enum?.['Status']).toMatchObject({
      codecId: 'pg/text@1',
      members: [
        { name: 'Active', value: 'active' },
        { name: 'Inactive', value: 'inactive' },
      ],
    });

    // storage value-set
    const storageNs = contract.storage.namespaces['public'];
    expect(storageNs?.entries.valueSet?.['Status']?.values).toEqual(['active', 'inactive']);

    // domain field valueSet
    const postModel = domainNs?.models?.['Post'];
    expect(postModel?.fields?.['status']?.valueSet).toEqual({
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: 'public',
      name: 'Status',
    });

    // storage column valueSet
    const postTable = storageNs?.entries.table?.['Post'];
    expect(postTable?.columns?.['status']?.valueSet).toEqual({
      plane: 'storage',
      entityKind: 'value-set',
      namespaceId: 'public',
      name: 'Status',
    });
  });
});
