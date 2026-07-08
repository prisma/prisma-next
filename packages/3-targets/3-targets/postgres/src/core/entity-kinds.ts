import type { EntityKindDescriptor } from '@prisma-next/framework-components/ir';
import { PostgresNativeEnum, type PostgresNativeEnumInput } from './postgres-native-enum';
import { PostgresRlsPolicy, type PostgresRlsPolicyInput } from './postgres-rls-policy';
import { PostgresRole, type PostgresRoleInput } from './postgres-role';
import {
  PostgresNativeEnumSchema,
  PostgresRlsPolicySchema,
  PostgresRoleSchema,
} from './postgres-validators';

export const policyEntityKind: EntityKindDescriptor<PostgresRlsPolicyInput, PostgresRlsPolicy> = {
  kind: 'policy',
  schema: PostgresRlsPolicySchema,
  construct: (input) => new PostgresRlsPolicy(input),
};

export const roleEntityKind: EntityKindDescriptor<PostgresRoleInput, PostgresRole> = {
  kind: 'role',
  schema: PostgresRoleSchema,
  construct: (input) => new PostgresRole(input),
};

export const nativeEnumEntityKind: EntityKindDescriptor<
  PostgresNativeEnumInput,
  PostgresNativeEnum
> = {
  kind: 'native_enum',
  schema: PostgresNativeEnumSchema,
  construct: (input) => new PostgresNativeEnum(input),
};
