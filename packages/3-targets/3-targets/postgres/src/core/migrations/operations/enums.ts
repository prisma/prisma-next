import { escapeLiteral, qualifyName, quoteIdentifier } from '../../sql-utils';
import { type Op, step, targetDetails } from './shared';

function enumTypeExistsCheck(schemaName: string, nativeType: string, exists = true): string {
  const clause = exists ? 'EXISTS' : 'NOT EXISTS';
  return `SELECT ${clause} (
  SELECT 1
  FROM pg_type t
  JOIN pg_namespace n ON t.typnamespace = n.oid
  WHERE n.nspname = '${escapeLiteral(schemaName)}'
    AND t.typname = '${escapeLiteral(nativeType)}'
)`;
}

export function createEnumType(
  schemaName: string,
  typeName: string,
  values: readonly string[],
): Op {
  const qualifiedType = qualifyName(schemaName, typeName);
  const literalValues = values.map((v) => `'${escapeLiteral(v)}'`).join(', ');
  return {
    id: `type.${typeName}`,
    label: `Create enum type "${typeName}"`,
    operationClass: 'additive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [
      step(
        `ensure type "${typeName}" does not exist`,
        enumTypeExistsCheck(schemaName, typeName, false),
      ),
    ],
    execute: [
      step(
        `create enum type "${typeName}"`,
        `CREATE TYPE ${qualifiedType} AS ENUM (${literalValues})`,
      ),
    ],
    postcheck: [
      step(`verify type "${typeName}" exists`, enumTypeExistsCheck(schemaName, typeName)),
    ],
  };
}

/**
 * `typeName` is the contract-facing type name (used for id/label).
 * `nativeType` is the Postgres type name to mutate (may differ for external types).
 */
export function addEnumValues(
  schemaName: string,
  typeName: string,
  nativeType: string,
  values: readonly string[],
): Op {
  const qualifiedType = qualifyName(schemaName, nativeType);
  return {
    id: `type.${typeName}.addValues`,
    label: `Add values to enum type "${typeName}": ${values.join(', ')}`,
    operationClass: 'additive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [
      step(`ensure type "${nativeType}" exists`, enumTypeExistsCheck(schemaName, nativeType)),
    ],
    execute: values.map((value) =>
      step(
        `add value '${value}' to enum "${nativeType}"`,
        `ALTER TYPE ${qualifiedType} ADD VALUE '${escapeLiteral(value)}'`,
      ),
    ),
    postcheck: [
      step(`verify type "${nativeType}" exists`, enumTypeExistsCheck(schemaName, nativeType)),
    ],
  };
}

export function dropEnumType(schemaName: string, typeName: string): Op {
  const qualified = qualifyName(schemaName, typeName);
  return {
    id: `type.${typeName}.drop`,
    label: `Drop enum type "${typeName}"`,
    operationClass: 'destructive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [step(`ensure type "${typeName}" exists`, enumTypeExistsCheck(schemaName, typeName))],
    execute: [step(`drop enum type "${typeName}"`, `DROP TYPE ${qualified}`)],
    postcheck: [
      step(`verify type "${typeName}" removed`, enumTypeExistsCheck(schemaName, typeName, false)),
    ],
  };
}

export function renameType(schemaName: string, fromName: string, toName: string): Op {
  const qualifiedFrom = qualifyName(schemaName, fromName);
  return {
    id: `type.${fromName}.rename`,
    label: `Rename type "${fromName}" to "${toName}"`,
    operationClass: 'destructive',
    target: targetDetails('type', fromName, schemaName),
    precheck: [
      step(`ensure type "${fromName}" exists`, enumTypeExistsCheck(schemaName, fromName)),
      step(
        `ensure type "${toName}" does not already exist`,
        enumTypeExistsCheck(schemaName, toName, false),
      ),
    ],
    execute: [
      step(
        `rename type "${fromName}" to "${toName}"`,
        `ALTER TYPE ${qualifiedFrom} RENAME TO ${quoteIdentifier(toName)}`,
      ),
    ],
    postcheck: [step(`verify type "${toName}" exists`, enumTypeExistsCheck(schemaName, toName))],
  };
}
