import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { ifDefined } from '@prisma-next/utils/defined';
import { rlsEnabledAst, rlsPolicyExistsAst } from '../../../contract-free/checks';
import { createPolicy, dropPolicy } from '../../../contract-free/ddl';
import type { PostgresRlsPolicy } from '../../postgres-rls-policy';
import { qualifyTableName } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function validateRoleName(role: string): string {
  if (!PLAIN_IDENTIFIER.test(role)) {
    throw new Error(
      `Invalid role name ${JSON.stringify(role)}: role names must be plain SQL identifiers matching ^[A-Za-z_][A-Za-z0-9_$]*$`,
    );
  }
  return role;
}

export async function createRlsPolicy(
  schemaName: string,
  tableName: string,
  policy: PostgresRlsPolicy,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const validatedRoles = policy.roles.map(validateRoleName);
  const ddlNode = createPolicy({
    schema: schemaName,
    table: tableName,
    name: policy.name,
    permissive: policy.permissive,
    operation: policy.operation,
    roles: validatedRoles,
    ...ifDefined('using', policy.using),
    ...ifDefined('withCheck', policy.withCheck),
  });
  const checks = rlsPolicyExistsAst({
    schema: schemaName,
    table: tableName,
    policyName: policy.name,
  });
  const absent = await lowerer.lowerToExecuteRequest(checks.policyAbsent());
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  const present = await lowerer.lowerToExecuteRequest(checks.policyPresent());
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${policy.name}`,
    label: `Create RLS policy "${policy.name}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('rlsPolicy', policy.name, schemaName, tableName),
    precheck: [
      step(`ensure RLS policy "${policy.name}" does not exist`, absent.sql, absent.params),
    ],
    execute: [step(`create RLS policy "${policy.name}"`, execute.sql, execute.params)],
    postcheck: [step(`verify RLS policy "${policy.name}" exists`, present.sql, present.params)],
  };
}

export async function dropRlsPolicy(
  schemaName: string,
  tableName: string,
  policyName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const ddlNode = dropPolicy({ schema: schemaName, table: tableName, name: policyName });
  const checks = rlsPolicyExistsAst({ schema: schemaName, table: tableName, policyName });
  const present = await lowerer.lowerToExecuteRequest(checks.policyPresent());
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  const absent = await lowerer.lowerToExecuteRequest(checks.policyAbsent());
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${policyName}.drop`,
    label: `Drop RLS policy "${policyName}" on "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('rlsPolicy', policyName, schemaName, tableName),
    precheck: [step(`ensure RLS policy "${policyName}" exists`, present.sql, present.params)],
    execute: [step(`drop RLS policy "${policyName}"`, execute.sql, execute.params)],
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
