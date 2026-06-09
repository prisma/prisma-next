import { type } from 'arktype';

export const PostgresRoleSchema = type({
  kind: "'postgres-role'",
  name: 'string',
  namespaceId: 'string',
});

export const PostgresRlsPolicySchema = type({
  kind: "'postgres-rls-policy'",
  name: 'string',
  prefix: 'string',
  tableName: 'string',
  operation: "'select' | 'insert' | 'update' | 'delete' | 'all'",
  roles: type.string.array().readonly(),
  'using?': 'string',
  'withCheck?': 'string',
  permissive: 'boolean',
});
