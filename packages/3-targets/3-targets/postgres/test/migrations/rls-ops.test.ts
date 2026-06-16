import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { describe, expect, it } from 'vitest';
import { rlsEnabledAst, rlsPolicyExistsAst } from '../../src/contract-free/checks';
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

function recordingCheckLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({
        sql: `LOWERED ${received.length}`,
        params: Object.freeze([`p${received.length}`]),
      });
    },
  };
  return { lowerer, received };
}

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

  it('renders TO PUBLIC when roles is empty', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await createRlsPolicy('public', 'profiles', policyWithRoles([]), lowerer);
    expect(op.execute[0]?.sql).toContain('TO PUBLIC');
    expect(op.execute[0]?.sql).not.toContain('TO ,');
  });

  it('renders a plain SQL identifier role without error', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await createRlsPolicy('public', 'profiles', policyWithRoles(['app_user']), lowerer);
    expect(op.execute[0]?.sql).toContain('TO app_user');
  });

  it('renders multiple valid role names', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await createRlsPolicy(
      'public',
      'profiles',
      policyWithRoles(['app_user', 'read_only']),
      lowerer,
    );
    expect(op.execute[0]?.sql).toContain('TO app_user, read_only');
  });

  it('rejects a role name containing a double-quote', async () => {
    const { lowerer } = recordingCheckLowerer();
    await expect(
      createRlsPolicy('public', 'profiles', policyWithRoles(['a"b']), lowerer),
    ).rejects.toThrow(/invalid role name/i);
  });

  it('rejects a role name containing a space', async () => {
    const { lowerer } = recordingCheckLowerer();
    await expect(
      createRlsPolicy('public', 'profiles', policyWithRoles(['my role']), lowerer),
    ).rejects.toThrow(/invalid role name/i);
  });

  it('rejects a role name containing a semicolon', async () => {
    const { lowerer } = recordingCheckLowerer();
    await expect(
      createRlsPolicy('public', 'profiles', policyWithRoles(['role;DROP TABLE']), lowerer),
    ).rejects.toThrow(/invalid role name/i);
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
  it('emits the correct CREATE POLICY DDL', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    expect(op.execute[0]?.sql).toBe(
      `CREATE POLICY "read_own_profiles_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id))`,
    );
  });

  it('emits WITH CHECK clause when present', async () => {
    const { lowerer } = recordingCheckLowerer();
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
    const op = await createRlsPolicy('public', 'profiles', policy, lowerer);
    expect(op.execute[0]?.sql).toBe(
      `CREATE POLICY "insert_own_profiles_ab12cd34" ON "public"."profiles" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id))`,
    );
  });

  it('emits AS RESTRICTIVE when permissive is false', async () => {
    const { lowerer } = recordingCheckLowerer();
    const policy = new PostgresRlsPolicy({
      ...basePolicy,
      name: 'restrict_profiles_ab12cd34',
      prefix: 'restrict_profiles',
      permissive: false,
    });
    const op = await createRlsPolicy('public', 'profiles', policy, lowerer);
    expect(op.execute[0]?.sql).toContain('AS RESTRICTIVE');
  });

  it('lowers a parameterized policy-absent precheck (name never inlined)', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    expect(received).toContainEqual(
      rlsPolicyExistsAst({
        schema: 'public',
        table: 'profiles',
        policyName: 'read_own_profiles_ab12cd34',
      }).policyAbsent(),
    );
    expect(op.precheck[0]?.params).toEqual(['p1']);
    expect(op.precheck[0]?.sql).not.toContain('read_own_profiles_ab12cd34');
  });

  it('lowers a parameterized policy-present postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    expect(received).toContainEqual(
      rlsPolicyExistsAst({
        schema: 'public',
        table: 'profiles',
        policyName: 'read_own_profiles_ab12cd34',
      }).policyPresent(),
    );
    expect(op.postcheck[0]?.params).toEqual(['p2']);
  });

  it('operationClass is additive', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    expect(op.operationClass).toBe('additive');
  });
});

describe('enableRowLevelSecurity op', () => {
  it('emits the correct ALTER TABLE DDL', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await enableRowLevelSecurity('public', 'profiles', lowerer);
    expect(op.execute[0]?.sql).toBe(`ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY`);
  });

  it('lowers a parameterized rls-disabled precheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await enableRowLevelSecurity('public', 'profiles', lowerer);
    expect(received).toContainEqual(rlsEnabledAst('public', 'profiles').rlsDisabled());
  });

  it('lowers a parameterized rls-enabled postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await enableRowLevelSecurity('public', 'profiles', lowerer);
    expect(received).toContainEqual(rlsEnabledAst('public', 'profiles').rlsEnabled());
  });

  it('operationClass is additive', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await enableRowLevelSecurity('public', 'profiles', lowerer);
    expect(op.operationClass).toBe('additive');
  });
});

describe('dropRlsPolicy op', () => {
  it('emits the correct DROP POLICY DDL', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34', lowerer);
    expect(op.execute[0]?.sql).toBe(
      `DROP POLICY "read_own_profiles_ab12cd34" ON "public"."profiles"`,
    );
  });

  it('lowers a parameterized policy-present precheck (name never inlined)', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34', lowerer);
    expect(received).toContainEqual(
      rlsPolicyExistsAst({
        schema: 'public',
        table: 'profiles',
        policyName: 'read_own_profiles_ab12cd34',
      }).policyPresent(),
    );
    expect(op.precheck[0]?.sql).not.toContain('read_own_profiles_ab12cd34');
  });

  it('lowers a parameterized policy-absent postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34', lowerer);
    expect(received).toContainEqual(
      rlsPolicyExistsAst({
        schema: 'public',
        table: 'profiles',
        policyName: 'read_own_profiles_ab12cd34',
      }).policyAbsent(),
    );
  });

  it('operationClass is destructive', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34', lowerer);
    expect(op.operationClass).toBe('destructive');
  });
});

describe('CreatePostgresRlsPolicyCall', () => {
  it('toOp() returns the same DDL as createRlsPolicy()', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new CreatePostgresRlsPolicyCall('public', 'profiles', basePolicy);
    const directOp = await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    const callOp = await call.toOp(lowerer);
    expect(callOp.execute[0]?.sql).toBe(directOp.execute[0]?.sql);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreatePostgresRlsPolicyCall('public', 'profiles', basePolicy);
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
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
  it('toOp() returns the correct DDL', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    const op = await call.toOp(lowerer);
    expect(op.execute[0]?.sql).toBe(`ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY`);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
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
  it('toOp() returns the same DDL as dropRlsPolicy()', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    const directOp = await dropRlsPolicy(
      'public',
      'profiles',
      'read_own_profiles_ab12cd34',
      lowerer,
    );
    const callOp = await call.toOp(lowerer);
    expect(callOp.execute[0]?.sql).toBe(directOp.execute[0]?.sql);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
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
