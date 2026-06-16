import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { rlsEnabledAst, rlsPolicyExistsAst } from '../../../contract-free/checks';
import type { PostgresRlsPolicy, RlsPolicyOperation } from '../../postgres-rls-policy';
import { quoteIdentifier } from '../../sql-utils';
import { qualifyTableName } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

const OPERATION_SQL: Record<RlsPolicyOperation, string> = {
  select: 'SELECT',
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  all: 'ALL',
};

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

export async function createRlsPolicy(
  schemaName: string,
  tableName: string,
  policy: PostgresRlsPolicy,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const checks = rlsPolicyExistsAst({
    schema: schemaName,
    table: tableName,
    policyName: policy.name,
  });
  const absent = await lowerer.lowerToExecuteRequest(checks.policyAbsent());
  const present = await lowerer.lowerToExecuteRequest(checks.policyPresent());
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${policy.name}`,
    label: `Create RLS policy "${policy.name}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('rlsPolicy', policy.name, schemaName, tableName),
    precheck: [
      step(`ensure RLS policy "${policy.name}" does not exist`, absent.sql, absent.params),
    ],
    execute: [
      step(
        `create RLS policy "${policy.name}"`,
        renderCreatePolicySql(schemaName, tableName, policy),
      ),
    ],
    postcheck: [step(`verify RLS policy "${policy.name}" exists`, present.sql, present.params)],
  };
}

export async function dropRlsPolicy(
  schemaName: string,
  tableName: string,
  policyName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const checks = rlsPolicyExistsAst({ schema: schemaName, table: tableName, policyName });
  const present = await lowerer.lowerToExecuteRequest(checks.policyPresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.policyAbsent());
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${policyName}.drop`,
    label: `Drop RLS policy "${policyName}" on "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('rlsPolicy', policyName, schemaName, tableName),
    precheck: [step(`ensure RLS policy "${policyName}" exists`, present.sql, present.params)],
    execute: [
      step(
        `drop RLS policy "${policyName}"`,
        `DROP POLICY ${quoteIdentifier(policyName)} ON ${qualifyTableName(schemaName, tableName)}`,
      ),
    ],
    postcheck: [step(`verify RLS policy "${policyName}" is absent`, absent.sql, absent.params)],
  };
}

export async function enableRowLevelSecurity(
  schemaName: string,
  tableName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const checks = rlsEnabledAst(schemaName, tableName);
  const disabled = await lowerer.lowerToExecuteRequest(checks.rlsDisabled());
  const enabled = await lowerer.lowerToExecuteRequest(checks.rlsEnabled());
  return {
    id: `rowLevelSecurity.${schemaName}.${tableName}`,
    label: `Enable row-level security on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('rowLevelSecurity', tableName, schemaName),
    precheck: [
      step(`check RLS is not already enabled on "${tableName}"`, disabled.sql, disabled.params),
    ],
    execute: [
      step(
        `enable row-level security on "${tableName}"`,
        `ALTER TABLE ${qualifyTableName(schemaName, tableName)} ENABLE ROW LEVEL SECURITY`,
      ),
    ],
    postcheck: [
      step(`verify row-level security is enabled on "${tableName}"`, enabled.sql, enabled.params),
    ],
  };
}
