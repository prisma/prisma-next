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

// ---------------------------------------------------------------------------
// db.enums.<Name>.values is the ordered literal tuple, not string[]
// ---------------------------------------------------------------------------

test('db.enums.Role.values is the literal value tuple', () => {
  expectTypeOf(db.enums.Role.values).toEqualTypeOf<readonly ['user', 'admin']>();
});

test('db.enums.Role.values is not a widened string[]', () => {
  expectTypeOf(db.enums.Role.values).not.toEqualTypeOf<readonly string[]>();
});

test('db.enums.Status.values preserves declaration order as a literal tuple', () => {
  expectTypeOf(db.enums.Status.values).toEqualTypeOf<readonly ['active', 'inactive']>();
});

// ---------------------------------------------------------------------------
// db.enums.<Name>.members.<Name> resolves to the member value literal
// ---------------------------------------------------------------------------

test('db.enums.Role.members.User is the value literal', () => {
  expectTypeOf(db.enums.Role.members.User).toEqualTypeOf<'user'>();
});

test('db.enums.Role.members.Admin is the value literal', () => {
  expectTypeOf(db.enums.Role.members.Admin).toEqualTypeOf<'admin'>();
});

// ---------------------------------------------------------------------------
// db.enums.<Name>.names is the literal name tuple
// ---------------------------------------------------------------------------

test('db.enums.Role.names is the literal name tuple', () => {
  expectTypeOf(db.enums.Role.names).toEqualTypeOf<readonly ['User', 'Admin']>();
});
