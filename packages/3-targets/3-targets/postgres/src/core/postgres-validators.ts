import { type } from 'arktype';

export const PostgresRoleSchema = type({
  kind: "'role'",
  name: 'string',
  namespaceId: 'string',
});

export const PostgresRlsPolicySchema = type({
  kind: "'policy'",
  name: 'string',
  prefix: 'string',
  tableName: 'string',
  namespaceId: 'string',
  operation: "'select' | 'insert' | 'update' | 'delete' | 'all'",
  roles: type.string.array().readonly(),
  'using?': 'string',
  'withCheck?': 'string',
  permissive: 'boolean',
});

const PostgresNativeEnumMemberSchema = type({
  name: 'string',
  value: 'string',
});

export const PostgresNativeEnumSchema = type({
  kind: "'postgres-enum'",
  typeName: 'string',
  members: PostgresNativeEnumMemberSchema.array().readonly(),
  'control?': "'managed' | 'tolerated' | 'external' | 'observed'",
});
