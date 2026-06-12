import type { ExecuteRequestLowerer } from '@prisma-next/family-sql/control-adapter';
import { enumTypeExistsAst } from '../../../contract-free/checks';
import { escapeLiteral, qualifyName, quoteIdentifier } from '../../sql-utils';
import { type Op, step, targetDetails } from './shared';

type CheckStep = { sql: string; params?: readonly unknown[] };

async function enumTypeSteps(
  lowerer: ExecuteRequestLowerer,
  schemaName: string,
  typeName: string,
): Promise<{ present: CheckStep; absent: CheckStep }> {
  const checks = enumTypeExistsAst({ schema: schemaName, typeName });
  const present = await lowerer.lowerToExecuteRequest(checks.typePresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.typeAbsent());
  return { present, absent };
}

export async function createEnumType(
  schemaName: string,
  typeName: string,
  values: readonly string[],
  lowerer: ExecuteRequestLowerer,
  nativeType: string = typeName,
): Promise<Op> {
  const qualifiedType = qualifyName(schemaName, nativeType);
  const literalValues = values.map((v) => `'${escapeLiteral(v)}'`).join(', ');
  const { present, absent } = await enumTypeSteps(lowerer, schemaName, nativeType);
  return {
    id: `type.${typeName}`,
    label: `Create enum type "${typeName}"`,
    operationClass: 'additive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [step(`ensure type "${nativeType}" does not exist`, absent.sql, absent.params)],
    execute: [
      step(
        `create enum type "${typeName}"`,
        `CREATE TYPE ${qualifiedType} AS ENUM (${literalValues})`,
      ),
    ],
    postcheck: [step(`verify type "${nativeType}" exists`, present.sql, present.params)],
  };
}

/**
 * `typeName` is the contract-facing type name (used for id/label).
 * `nativeType` is the Postgres type name to mutate (may differ for external types).
 */
export async function addEnumValues(
  schemaName: string,
  typeName: string,
  nativeType: string,
  values: readonly string[],
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualifiedType = qualifyName(schemaName, nativeType);
  const { present } = await enumTypeSteps(lowerer, schemaName, nativeType);
  return {
    id: `type.${typeName}.addValues`,
    label: `Add values to enum type "${typeName}": ${values.join(', ')}`,
    operationClass: 'additive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [step(`ensure type "${nativeType}" exists`, present.sql, present.params)],
    execute: values.map((value) =>
      step(
        `add value '${value}' to enum "${nativeType}"`,
        `ALTER TYPE ${qualifiedType} ADD VALUE '${escapeLiteral(value)}'`,
      ),
    ),
    postcheck: [step(`verify type "${nativeType}" exists`, present.sql, present.params)],
  };
}

export async function dropEnumType(
  schemaName: string,
  typeName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualified = qualifyName(schemaName, typeName);
  const { present, absent } = await enumTypeSteps(lowerer, schemaName, typeName);
  return {
    id: `type.${typeName}.drop`,
    label: `Drop enum type "${typeName}"`,
    operationClass: 'destructive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [step(`ensure type "${typeName}" exists`, present.sql, present.params)],
    execute: [step(`drop enum type "${typeName}"`, `DROP TYPE ${qualified}`)],
    postcheck: [step(`verify type "${typeName}" removed`, absent.sql, absent.params)],
  };
}

export async function renameType(
  schemaName: string,
  fromName: string,
  toName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const qualifiedFrom = qualifyName(schemaName, fromName);
  const from = await enumTypeSteps(lowerer, schemaName, fromName);
  const to = await enumTypeSteps(lowerer, schemaName, toName);
  return {
    id: `type.${fromName}.rename`,
    label: `Rename type "${fromName}" to "${toName}"`,
    operationClass: 'destructive',
    target: targetDetails('type', fromName, schemaName),
    precheck: [
      step(`ensure type "${fromName}" exists`, from.present.sql, from.present.params),
      step(`ensure type "${toName}" does not already exist`, to.absent.sql, to.absent.params),
    ],
    execute: [
      step(
        `rename type "${fromName}" to "${toName}"`,
        `ALTER TYPE ${qualifiedFrom} RENAME TO ${quoteIdentifier(toName)}`,
      ),
    ],
    postcheck: [step(`verify type "${toName}" exists`, to.present.sql, to.present.params)],
  };
}
