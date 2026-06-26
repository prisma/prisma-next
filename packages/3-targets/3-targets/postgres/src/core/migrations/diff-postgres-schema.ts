import type { Contract } from '@prisma-next/contract/types';
import type { SchemaDiffIssue } from '@prisma-next/framework-components/control';
import {
  diffSchemas,
  filterSchemaIssuesByOwnership,
} from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { isPostgresRlsPolicy } from '../postgres-rls-policy';
import type { PostgresContract } from '../postgres-schema';
import { resolveNamespaceId } from '../postgres-schema';
import { PostgresSchemaIR, type PostgresSchemaIRInput } from '../postgres-schema-ir';
import { contractToPostgresSchemaIR } from './contract-to-postgres-schema-ir';

/**
 * Computes RLS policy drift between the contract and the live DB schema.
 * Ownership filtering is applied to the diff's outcomes, not its inputs.
 *
 * The actual `schema` may arrive as a plain spread object (from
 * `projectSchemaToSpace`) rather than a class instance: prototype methods like
 * `children()` would be missing. Reconstruct it as a real `PostgresSchemaIR` so
 * the diff can call `children()`, `localKey()`, and `isEqualTo()` safely.
 */
export function diffPostgresSchema(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: PostgresSchemaIR;
}): readonly SchemaDiffIssue[] {
  const { contract, schema } = input;
  const expected = contractToPostgresSchemaIR(
    blindCast<PostgresContract, 'diffPostgresSchema is only called with a postgres contract'>(
      contract,
    ),
    { annotationNamespace: 'pg' },
  );
  const actual =
    schema instanceof PostgresSchemaIR
      ? schema
      : new PostgresSchemaIR(
          blindCast<
            PostgresSchemaIRInput,
            'spread objects from projectSchemaToSpace preserve all own-enumerable fields'
          >(schema),
        );
  const issues = diffSchemas(expected, actual);

  const owned = new Set(Object.keys(contract.storage.namespaces).map(resolveNamespaceId));
  return filterSchemaIssuesByOwnership(
    issues,
    (namespaceId) => owned.has(resolveNamespaceId(namespaceId)),
    (node) => (isPostgresRlsPolicy(node) ? node.namespaceId : ''),
  );
}
