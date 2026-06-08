import { expectTypeOf, test } from 'vitest';
import type { SchemaIssue } from '../src/control/control-result-types';

test('rls_policy_renamed is a member of SchemaIssue', () => {
  type Kinds = SchemaIssue['kind'];
  expectTypeOf<'rls_policy_renamed'>().toMatchTypeOf<Kinds>();
});

test('rls_policy_tampered is a member of SchemaIssue', () => {
  type Kinds = SchemaIssue['kind'];
  expectTypeOf<'rls_policy_tampered'>().toMatchTypeOf<Kinds>();
});

test('rls_not_enabled is a member of SchemaIssue', () => {
  type Kinds = SchemaIssue['kind'];
  expectTypeOf<'rls_not_enabled'>().toMatchTypeOf<Kinds>();
});

test('RlsPolicyRenamedIssue payload is assignable to SchemaIssue', () => {
  const issue = {
    kind: 'rls_policy_renamed' as const,
    namespaceId: 'ns',
    tableName: 'users',
    fromName: 'old_prefix_abc12345',
    toName: 'new_prefix_abc12345',
    message: 'Policy renamed',
  };
  expectTypeOf(issue).toMatchTypeOf<SchemaIssue>();
});

test('RlsPolicyTamperedIssue payload is assignable to SchemaIssue', () => {
  const issue = {
    kind: 'rls_policy_tampered' as const,
    namespaceId: 'ns',
    tableName: 'users',
    policyName: 'rls_users_select_abc12345',
    message: 'Policy tampered',
  };
  expectTypeOf(issue).toMatchTypeOf<SchemaIssue>();
});

test('RlsNotEnabledIssue payload is assignable to SchemaIssue', () => {
  const issue = {
    kind: 'rls_not_enabled' as const,
    namespaceId: 'ns',
    tableName: 'users',
    message: 'RLS not enabled',
  };
  expectTypeOf(issue).toMatchTypeOf<SchemaIssue>();
});
