import { escapeLiteral, validateEnumValueLength } from '../../sql-utils';
import { qualifyTableName } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

/**
 * `CREATE TYPE <qualified> AS ENUM (…)` for a managed native enum. Members
 * render in declaration order (Postgres enum sort order is semantic), each
 * escaped as a SQL string literal. Qualification rides the polymorphic
 * namespace machinery (`qualifyTableName` quotes any schema-scoped object
 * name pair): the unbound sentinel renders unqualified so the connection's
 * `search_path` resolves the schema at runtime.
 */
export function createNativeEnumType(
  schemaName: string,
  typeName: string,
  members: readonly string[],
): Op {
  const qualified = qualifyTableName(schemaName, typeName);
  const memberList = members
    .map((member) => {
      validateEnumValueLength(member, typeName);
      return `'${escapeLiteral(member)}'`;
    })
    .join(', ');
  return {
    id: `createNativeEnumType.${typeName}`,
    label: `Create enum type "${typeName}"`,
    operationClass: 'additive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [],
    execute: [
      step(`create enum type "${typeName}"`, `CREATE TYPE ${qualified} AS ENUM (${memberList})`),
    ],
    postcheck: [],
  };
}

/** `DROP TYPE <qualified>` for an unclaimed managed native enum. */
export function dropNativeEnumType(schemaName: string, typeName: string): Op {
  const qualified = qualifyTableName(schemaName, typeName);
  return {
    id: `dropNativeEnumType.${typeName}`,
    label: `Drop enum type "${typeName}"`,
    operationClass: 'destructive',
    target: targetDetails('type', typeName, schemaName),
    precheck: [],
    execute: [step(`drop enum type "${typeName}"`, `DROP TYPE ${qualified}`)],
    postcheck: [],
  };
}
