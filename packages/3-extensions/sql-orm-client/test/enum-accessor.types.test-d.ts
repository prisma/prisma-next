import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { expectTypeOf, test } from 'vitest';
import type { NamespacedEnums } from '../src/enum-accessor';

// ---------------------------------------------------------------------------
// Minimal pack stubs (mirrors contract-ts enum-type.field-output.test.ts)
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

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;

const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
const Status = enumType(
  'Status',
  pgText,
  member('Active', 'active'),
  member('Inactive', 'inactive'),
);

const enumContract = defineContract({
  family: sqlFamilyPack,
  target: postgresTargetPack,
  enums: { Role, Status },
  models: {
    User: model('User', {
      fields: {
        role: field.namedType(Role),
        status: field.namedType(Status).optional(),
      },
    }),
  },
});

// The no-emit (built) contract types its domain namespaces loosely (index
// signature), so the `public` namespace is reached with bracket access. The
// enum accessor surface lives on the `db.enums` facade member, a
// namespace-keyed map derived directly from the contract.
type Enums = NamespacedEnums<typeof enumContract>;
const publicEnums = {} as Enums['public'];

// ---------------------------------------------------------------------------
// enums.<ns>.<Name>.values is the ordered literal tuple, not string[]
// ---------------------------------------------------------------------------

test('enums.public.Role.values is the literal value tuple', () => {
  expectTypeOf(publicEnums.Role.values).toEqualTypeOf<readonly ['user', 'admin']>();
});

test('enums.public.Role.values is not a widened string[]', () => {
  expectTypeOf(publicEnums.Role.values).not.toEqualTypeOf<readonly string[]>();
});

test('enums.public.Status.values preserves declaration order as a literal tuple', () => {
  expectTypeOf(publicEnums.Status.values).toEqualTypeOf<readonly ['active', 'inactive']>();
});

// ---------------------------------------------------------------------------
// enums.<ns>.<Name>.members.<Name> resolves to the member value literal
// ---------------------------------------------------------------------------

test('enums.public.Role.members.User is the value literal', () => {
  expectTypeOf(publicEnums.Role.members.User).toEqualTypeOf<'user'>();
});

test('enums.public.Role.members.Admin is the value literal', () => {
  expectTypeOf(publicEnums.Role.members.Admin).toEqualTypeOf<'admin'>();
});

// ---------------------------------------------------------------------------
// enums.<ns>.<Name>.names is the literal name tuple
// ---------------------------------------------------------------------------

test('enums.public.Role.names is the literal name tuple', () => {
  expectTypeOf(publicEnums.Role.names).toEqualTypeOf<readonly ['User', 'Admin']>();
});
