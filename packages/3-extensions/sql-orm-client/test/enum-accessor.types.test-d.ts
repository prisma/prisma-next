import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
} from '@prisma-next/sql-contract-ts/contract-builder';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { orm } from '../src/orm';
import { createMockRuntime } from './helpers';

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

const db = orm({
  runtime: createMockRuntime(),
  context: {} as unknown as ExecutionContext<typeof enumContract>,
});

// The no-emit (built) contract types its domain namespaces loosely (index
// signature), so the `public` facet is reached with bracket access and a
// non-null guard — the same shape the demo's `createOrmClient` uses. The enum
// accessor surface lives on the facet under the reserved `enums` key.
type PublicFacet = NonNullable<(typeof db)['public']>;
const publicEnums = {} as PublicFacet['enums'];

// ---------------------------------------------------------------------------
// <facet>.enums.<Name>.values is the ordered literal tuple, not string[]
// ---------------------------------------------------------------------------

test('facet.enums.Role.values is the literal value tuple', () => {
  expectTypeOf(publicEnums.Role.values).toEqualTypeOf<readonly ['user', 'admin']>();
});

test('facet.enums.Role.values is not a widened string[]', () => {
  expectTypeOf(publicEnums.Role.values).not.toEqualTypeOf<readonly string[]>();
});

test('facet.enums.Status.values preserves declaration order as a literal tuple', () => {
  expectTypeOf(publicEnums.Status.values).toEqualTypeOf<readonly ['active', 'inactive']>();
});

// ---------------------------------------------------------------------------
// <facet>.enums.<Name>.members.<Name> resolves to the member value literal
// ---------------------------------------------------------------------------

test('facet.enums.Role.members.User is the value literal', () => {
  expectTypeOf(publicEnums.Role.members.User).toEqualTypeOf<'user'>();
});

test('facet.enums.Role.members.Admin is the value literal', () => {
  expectTypeOf(publicEnums.Role.members.Admin).toEqualTypeOf<'admin'>();
});

// ---------------------------------------------------------------------------
// <facet>.enums.<Name>.names is the literal name tuple
// ---------------------------------------------------------------------------

test('facet.enums.Role.names is the literal name tuple', () => {
  expectTypeOf(publicEnums.Role.names).toEqualTypeOf<readonly ['User', 'Admin']>();
});
