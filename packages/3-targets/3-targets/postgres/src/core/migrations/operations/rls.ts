import type { PostgresRlsPolicy, RlsPolicyOperation } from '../../postgres-rls-policy';
import { escapeLiteral, quoteIdentifier } from '../../sql-utils';
import { qualifyTableName } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

const OPERATION_SQL: Record<RlsPolicyOperation, string> = {
  select: 'SELECT',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  all: 'ALL',
};

function rlsPolicyExistsCheck(
  schemaName: string,
  tableName: string,
  policyName: string,
  exists: boolean,
): string {
  const existsClause = exists ? 'EXISTS' : 'NOT EXISTS';
  return `SELECT ${existsClause} (
  SELECT 1 FROM pg_policies
  WHERE schemaname = '${escapeLiteral(schemaName)}'
    AND tablename = '${escapeLiteral(tableName)}'
    AND policyname = '${escapeLiteral(policyName)}'
)`;
}

function rlsEnabledCheck(schemaName: string, tableName: string, enabled: boolean): string {
  const boolLiteral = enabled ? 'true' : 'false';
  return `SELECT EXISTS (
  SELECT 1 FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = '${escapeLiteral(schemaName)}'
    AND c.relname = '${escapeLiteral(tableName)}'
    AND c.relrowsecurity = ${boolLiteral}
)`;
}

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function validateRoleName(role: string): string {
  if (!PLAIN_IDENTIFIER.test(role)) {
    throw new Error(
      `Invalid role name ${JSON.stringify(role)}: role names must be plain SQL identifiers matching ^[A-Za-z_][A-Za-z0-9_$]*$`,
    );
  }
  return role;
}

function renderCreatePolicySql(
  schemaName: string,
  tableName: string,
  policy: PostgresRlsPolicy,
): string {
  const permissiveness = policy.permissive ? 'PERMISSIVE' : 'RESTRICTIVE';
  const command = OPERATION_SQL[policy.operation];
  const roles =
    policy.roles.length === 0 ? 'PUBLIC' : policy.roles.map(validateRoleName).join(', ');
  let sql = `CREATE POLICY ${quoteIdentifier(policy.name)} ON ${qualifyTableName(schemaName, tableName)} AS ${permissiveness} FOR ${command} TO ${roles}`;
  if (policy.using !== undefined) {
    sql += ` USING (${policy.using})`;
  }
  if (policy.withCheck !== undefined) {
    sql += ` WITH CHECK (${policy.withCheck})`;
  }
  return sql;
}

export function createRlsPolicy(
  schemaName: string,
  tableName: string,
  policy: PostgresRlsPolicy,
): Op {
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${policy.name}`,
    label: `Create RLS policy "${policy.name}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('rlsPolicy', policy.name, schemaName, tableName),
    precheck: [
      step(
        `ensure RLS policy "${policy.name}" does not exist`,
        rlsPolicyExistsCheck(schemaName, tableName, policy.name, false),
      ),
    ],
    execute: [
      step(
        `create RLS policy "${policy.name}"`,
        renderCreatePolicySql(schemaName, tableName, policy),
      ),
    ],
    postcheck: [
      step(
        `verify RLS policy "${policy.name}" exists`,
        rlsPolicyExistsCheck(schemaName, tableName, policy.name, true),
      ),
    ],
  };
}

export function dropRlsPolicy(schemaName: string, tableName: string, policyName: string): Op {
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${policyName}.drop`,
    label: `Drop RLS policy "${policyName}" on "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('rlsPolicy', policyName, schemaName, tableName),
    precheck: [
      step(
        `ensure RLS policy "${policyName}" exists`,
        rlsPolicyExistsCheck(schemaName, tableName, policyName, true),
      ),
    ],
    execute: [
      step(
        `drop RLS policy "${policyName}"`,
        `DROP POLICY ${quoteIdentifier(policyName)} ON ${qualifyTableName(schemaName, tableName)}`,
      ),
    ],
    postcheck: [
      step(
        `verify RLS policy "${policyName}" is absent`,
        rlsPolicyExistsCheck(schemaName, tableName, policyName, false),
      ),
    ],
  };
}

export function enableRowLevelSecurity(schemaName: string, tableName: string): Op {
  return {
    id: `rowLevelSecurity.${schemaName}.${tableName}`,
    label: `Enable row-level security on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('rowLevelSecurity', tableName, schemaName),
    precheck: [
      step(
        `check RLS is not already enabled on "${tableName}"`,
        rlsEnabledCheck(schemaName, tableName, false),
      ),
    ],
    execute: [
      step(
        `enable row-level security on "${tableName}"`,
        `ALTER TABLE ${qualifyTableName(schemaName, tableName)} ENABLE ROW LEVEL SECURITY`,
      ),
    ],
    postcheck: [
      step(
        `verify row-level security is enabled on "${tableName}"`,
        rlsEnabledCheck(schemaName, tableName, true),
      ),
    ],
  };
}
