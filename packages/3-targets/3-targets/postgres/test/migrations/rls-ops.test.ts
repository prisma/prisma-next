import { describe, expect, it } from 'vitest';
import {
  CreatePostgresRlsPolicyCall,
  DropPostgresRlsPolicyCall,
  EnableRowLevelSecurityCall,
} from '../../src/core/migrations/op-factory-call';
import {
  createRlsPolicy,
  dropRlsPolicy,
  enableRowLevelSecurity,
} from '../../src/core/migrations/operations/rls';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';

describe('renderCreatePolicySql role-name validation', () => {
  function policyWithRoles(roles: string[]): PostgresRlsPolicy {
    return new PostgresRlsPolicy({
      name: 'p_ab12cd34',
      prefix: 'p',
      tableName: 'profiles',
      namespaceId: 'public',
      operation: 'select',
      roles,
      using: '(true)',
      permissive: true,
    });
  }

  it('renders a plain SQL identifier role without error', () => {
    const op = createRlsPolicy('public', 'profiles', policyWithRoles(['app_user']));
    expect(op.execute[0]?.sql).toContain('TO app_user');
  });

  it('renders multiple valid role names', () => {
    const op = createRlsPolicy('public', 'profiles', policyWithRoles(['app_user', 'read_only']));
    expect(op.execute[0]?.sql).toContain('TO app_user, read_only');
  });

  it('rejects a role name containing a double-quote', () => {
    expect(() => createRlsPolicy('public', 'profiles', policyWithRoles(['a"b']))).toThrow(
      /invalid role name/i,
    );
  });

  it('rejects a role name containing a space', () => {
    expect(() => createRlsPolicy('public', 'profiles', policyWithRoles(['my role']))).toThrow(
      /invalid role name/i,
    );
  });

  it('rejects a role name containing a semicolon', () => {
    expect(() =>
      createRlsPolicy('public', 'profiles', policyWithRoles(['role;DROP TABLE'])),
    ).toThrow(/invalid role name/i);
  });
});

const basePolicy = new PostgresRlsPolicy({
  name: 'read_own_profiles_ab12cd34',
  prefix: 'read_own_profiles',
  tableName: 'profiles',
  namespaceId: 'public',
  operation: 'select',
  roles: ['authenticated'],
  using: '(auth.uid() = user_id)',
  permissive: true,
});

describe('createRlsPolicy op', () => {
  it('emits the correct CREATE POLICY DDL', () => {
    const op = createRlsPolicy('public', 'profiles', basePolicy);
    const executeSql = op.execute[0]?.sql;
    expect(executeSql).toBe(
      `CREATE POLICY "read_own_profiles_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id))`,
    );
  });

  it('emits WITH CHECK clause when present', () => {
    const policy = new PostgresRlsPolicy({
      name: 'insert_own_profiles_ab12cd34',
      prefix: 'insert_own_profiles',
      tableName: 'profiles',
      namespaceId: 'public',
      operation: 'insert',
      roles: ['authenticated'],
      withCheck: '(auth.uid() = user_id)',
      permissive: true,
    });
    const op = createRlsPolicy('public', 'profiles', policy);
    const executeSql = op.execute[0]?.sql;
    expect(executeSql).toBe(
      `CREATE POLICY "insert_own_profiles_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id))`,
    );
  });

  it('emits AS RESTRICTIVE when permissive is false', () => {
    const policy = new PostgresRlsPolicy({
      ...basePolicy,
      name: 'restrict_profiles_ab12cd34',
      prefix: 'restrict_profiles',
      permissive: false,
    });
    const op = createRlsPolicy('public', 'profiles', policy);
    expect(op.execute[0]?.sql).toContain('AS RESTRICTIVE');
  });

  it('emits precheck asserting policy is absent', () => {
    const op = createRlsPolicy('public', 'profiles', basePolicy);
    const precheckSql = op.precheck[0]?.sql ?? '';
    expect(precheckSql).toContain('pg_policies');
    expect(precheckSql).toContain('NOT EXISTS');
    expect(precheckSql).toContain('read_own_profiles_ab12cd34');
  });

  it('emits postcheck asserting policy is present', () => {
    const op = createRlsPolicy('public', 'profiles', basePolicy);
    const postcheckSql = op.postcheck[0]?.sql ?? '';
    expect(postcheckSql).toContain('pg_policies');
    expect(postcheckSql).not.toContain('NOT EXISTS');
    expect(postcheckSql).toContain('read_own_profiles_ab12cd34');
  });

  it('operationClass is additive', () => {
    const op = createRlsPolicy('public', 'profiles', basePolicy);
    expect(op.operationClass).toBe('additive');
  });
});

describe('enableRowLevelSecurity op', () => {
  it('emits the correct ALTER TABLE DDL', () => {
    const op = enableRowLevelSecurity('public', 'profiles');
    expect(op.execute[0]?.sql).toBe(`ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY`);
  });

  it('emits precheck reading pg_class.relrowsecurity', () => {
    const op = enableRowLevelSecurity('public', 'profiles');
    const precheckSql = op.precheck[0]?.sql ?? '';
    expect(precheckSql).toContain('pg_class');
    expect(precheckSql).toContain('relrowsecurity');
  });

  it('emits postcheck asserting relrowsecurity = true', () => {
    const op = enableRowLevelSecurity('public', 'profiles');
    const postcheckSql = op.postcheck[0]?.sql ?? '';
    expect(postcheckSql).toContain('pg_class');
    expect(postcheckSql).toContain('relrowsecurity');
  });

  it('operationClass is additive', () => {
    const op = enableRowLevelSecurity('public', 'profiles');
    expect(op.operationClass).toBe('additive');
  });
});

describe('dropRlsPolicy op', () => {
  it('emits the correct DROP POLICY DDL', () => {
    const op = dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34');
    const executeSql = op.execute[0]?.sql;
    expect(executeSql).toBe(`DROP POLICY "read_own_profiles_ab12cd34" ON "public"."profiles"`);
  });

  it('emits precheck asserting policy is present', () => {
    const op = dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34');
    const precheckSql = op.precheck[0]?.sql ?? '';
    expect(precheckSql).toContain('pg_policies');
    expect(precheckSql).toContain('EXISTS');
    expect(precheckSql).not.toContain('NOT EXISTS');
    expect(precheckSql).toContain('read_own_profiles_ab12cd34');
  });

  it('emits postcheck asserting policy is absent', () => {
    const op = dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34');
    const postcheckSql = op.postcheck[0]?.sql ?? '';
    expect(postcheckSql).toContain('pg_policies');
    expect(postcheckSql).toContain('NOT EXISTS');
    expect(postcheckSql).toContain('read_own_profiles_ab12cd34');
  });

  it('operationClass is destructive', () => {
    const op = dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34');
    expect(op.operationClass).toBe('destructive');
  });
});

describe('CreatePostgresRlsPolicyCall', () => {
  it('toOp() returns the same DDL as createRlsPolicy()', () => {
    const call = new CreatePostgresRlsPolicyCall('public', 'profiles', basePolicy);
    const directOp = createRlsPolicy('public', 'profiles', basePolicy);
    expect(call.toOp().execute[0]?.sql).toBe(directOp.execute[0]?.sql);
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new CreatePostgresRlsPolicyCall('public', 'profiles', basePolicy);
    const rendered = call.renderTypeScript();
    expect(rendered).toContain('createRlsPolicy');
    expect(rendered).toContain('public');
    expect(rendered).toContain('profiles');
  });

  it('factoryName is createRlsPolicy', () => {
    const call = new CreatePostgresRlsPolicyCall('public', 'profiles', basePolicy);
    expect(call.factoryName).toBe('createRlsPolicy');
  });

  it('operationClass is additive', () => {
    const call = new CreatePostgresRlsPolicyCall('public', 'profiles', basePolicy);
    expect(call.operationClass).toBe('additive');
  });
});

describe('EnableRowLevelSecurityCall', () => {
  it('toOp() returns the correct DDL', () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    expect(call.toOp().execute[0]?.sql).toBe(
      `ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY`,
    );
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    const rendered = call.renderTypeScript();
    expect(rendered).toContain('enableRowLevelSecurity');
    expect(rendered).toContain('public');
    expect(rendered).toContain('profiles');
  });

  it('factoryName is enableRowLevelSecurity', () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    expect(call.factoryName).toBe('enableRowLevelSecurity');
  });

  it('operationClass is additive', () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    expect(call.operationClass).toBe('additive');
  });
});

describe('DropPostgresRlsPolicyCall', () => {
  it('toOp() returns the same DDL as dropRlsPolicy()', () => {
    const call = new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    const directOp = dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34');
    expect(call.toOp().execute[0]?.sql).toBe(directOp.execute[0]?.sql);
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    const rendered = call.renderTypeScript();
    expect(rendered).toContain('dropRlsPolicy');
    expect(rendered).toContain('public');
    expect(rendered).toContain('profiles');
    expect(rendered).toContain('read_own_profiles_ab12cd34');
  });

  it('factoryName is dropRlsPolicy', () => {
    const call = new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    expect(call.factoryName).toBe('dropRlsPolicy');
  });

  it('operationClass is destructive', () => {
    const call = new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    expect(call.operationClass).toBe('destructive');
  });
});
