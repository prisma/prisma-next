import type { Contract } from '@prisma-next/contract/types';
import { verifySqlSchemaTree } from '@prisma-next/family-sql/diff';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  DiffableNode,
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { diffSchemas, SchemaDiff } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { parsePostgresDefault } from '../default-normalizer';
import { normalizeSchemaNativeType } from '../native-type-normalizer';
import type { PostgresContract } from '../postgres-schema';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresPolicySchemaNode } from '../schema-ir/postgres-policy-schema-node';
import { contractToPostgresDatabaseSchemaNode } from './contract-to-postgres-database-schema-node';

interface PostgresDiffDatabaseSchemaInput {
  readonly contract: Contract<SqlStorage>;
  readonly actualSchema: SqlSchemaIRNode;
  readonly strict: boolean;
  readonly typeMetadataRegistry: ReadonlyMap<string, { readonly nativeType?: string }>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}

/**
 * The single combined database-schema comparison — the one computation the
 * migration planner and the family schema verify both consume. Composes,
 * once each:
 *
 * - the per-namespace-paired relational diff (`verifySqlSchemaTree`) → table /
 *   column / constraint findings as framework `SchemaIssue`s (with the
 *   verification-tree `root` and pass/warn/fail counts);
 * - the policy diff (`diffPostgresSchema` over the two trees) → RLS policy
 *   presence as `SchemaDiffIssue`s, ownership-filtered to the contract's owned
 *   schemas.
 *
 * `diffPostgresDatabaseSchema` and `verifyPostgresDatabaseSchema` both read
 * this single result, so the relational walk runs once per caller — never
 * once for the diff and again for the verify tree.
 */
function computePostgresSchemaComparison(input: PostgresDiffDatabaseSchemaInput): {
  readonly relational: VerifyDatabaseSchemaResult;
  readonly schemaDiffIssues: readonly SchemaDiffIssue[];
} {
  const postgresContract = blindCast<
    PostgresContract,
    'diffPostgresDatabaseSchema is only called with a postgres contract'
  >(input.contract);

  // Relational diff: per-namespace-paired so a multi-schema database checks each
  // contract namespace against its own actual node.
  const relational = verifySqlSchemaTree({
    contract: input.contract,
    actualSchema: input.actualSchema,
    buildExpectedSchema: (scopedContract) =>
      contractToPostgresDatabaseSchemaNode(
        blindCast<
          PostgresContract | null,
          'the relational pairing projects a scoped postgres contract'
        >(scopedContract),
        { annotationNamespace: 'pg' },
      ),
    strict: input.strict,
    typeMetadataRegistry: input.typeMetadataRegistry,
    frameworkComponents: input.frameworkComponents,
    normalizeDefault: parsePostgresDefault,
    normalizeNativeType: normalizeSchemaNativeType,
  });

  // Policy diff: the generic node differ over the expected/actual policy trees,
  // ownership-filtered to the schemas the contract owns (so unowned-namespace
  // policies are not reported as extras). The actual schema is always the
  // Postgres database root in production — assert it, matching the prior
  // `collectSchemaDiffIssues` / `planPostgresSchemaDiff` behaviour.
  PostgresDatabaseSchemaNode.assert(input.actualSchema);
  const expected = contractToPostgresDatabaseSchemaNode(postgresContract, {
    annotationNamespace: 'pg',
  });
  const schemaDiffIssues = filterIssuesByOwnership(
    diffPostgresSchema(expected, input.actualSchema),
    ownedSchemaNames(expected),
  );

  return { relational, schemaDiffIssues };
}

/**
 * The `SchemaDiffer` for Postgres: the target's black-box comparison,
 * projected to the two issue lists. Namespace presence (`missing_schema` →
 * `CREATE SCHEMA`) is intentionally NOT composed here: it is a planner-only
 * op-generation concern (verify rejects on the relational `missing_table` a
 * missing schema already produces), so the planner stitches it in around this
 * diff. Control-policy suppression of the policy issues is likewise a
 * per-consumer post-step (verify filters the issues; the planner filters the
 * calls).
 */
export function diffPostgresDatabaseSchema(input: PostgresDiffDatabaseSchemaInput): SchemaDiff {
  const { relational, schemaDiffIssues } = computePostgresSchemaComparison(input);
  return new SchemaDiff(relational.schema.issues, schemaDiffIssues);
}

/**
 * The same combined comparison as {@link diffPostgresDatabaseSchema}, wrapped
 * in the verify envelope (`ok`/`summary`/`code`/`target`/`timings`) plus the
 * pass/warn/fail tree the CLI renders — i.e. exactly the existing verify-result
 * schema shape, so nothing downstream changes.
 */
export function verifyPostgresDatabaseSchema(
  input: PostgresDiffDatabaseSchemaInput,
): VerifyDatabaseSchemaResult {
  const { relational, schemaDiffIssues } = computePostgresSchemaComparison(input);
  return {
    ...relational,
    schema: { ...relational.schema, schemaDiffIssues },
  };
}

function ownedSchemaNames(expected: PostgresDatabaseSchemaNode): ReadonlySet<string> {
  const policyNamespaces = Object.values(expected.namespaces).flatMap((ns) =>
    Object.values(ns.tables).flatMap((t) => t.policies.map((p) => p.namespaceId)),
  );
  return new Set([...policyNamespaces, ...expected.existingSchemas]);
}

// Every node in a diff issue produced from Postgres schema trees is a
// `SqlSchemaIRNode`; the framework types it as the narrower `DiffableNode`.
function asSchemaNode(node: DiffableNode): SqlSchemaIRNode {
  return blindCast<
    SqlSchemaIRNode,
    'diff issues over Postgres schema trees carry SqlSchemaIRNode nodes'
  >(node);
}

// Renders a display-only reference string for the diff message. If policy
// rendering grows, route it through the adapter's SQL renderer so the message
// can't diverge from the emitted policy SQL.
function renderPostgresPolicyReference(policy: PostgresPolicySchemaNode): string {
  return `policy "${policy.name}" on "${policy.namespaceId}"."${policy.tableName}"`;
}

/**
 * The policy node-diff — the structural half of the combined comparison above.
 * Computes RLS-policy drift between two derived schema trees:
 *
 * 1. Runs the framework total diff over the two `PostgresDatabaseSchemaNode`
 *    roots (database → namespace → table → policy).
 * 2. Filters to policy-subject issues only — this is transitional: the generic
 *    differ walks the whole tree, but the legacy relational verifier still owns
 *    table/column drift, so non-policy issues are dropped here.
 * 3. Remaps the message to a human-readable policy reference.
 *
 * Ownership filtering (dropping `extra` issues in namespaces a contract doesn't
 * own) is the caller's responsibility — use `filterIssuesByOwnership`.
 */
export function diffPostgresSchema(
  expected: PostgresDatabaseSchemaNode,
  actual: PostgresDatabaseSchemaNode,
): readonly SchemaDiffIssue[] {
  const issues = diffSchemas(expected, actual);

  return issues
    .filter((i) => {
      const node = i.expected ?? i.actual;
      return node !== undefined && PostgresPolicySchemaNode.is(asSchemaNode(node));
    })
    .map((i) => {
      const node = i.expected ?? i.actual;
      if (node === undefined) return i;
      const policy = asSchemaNode(node);
      if (!PostgresPolicySchemaNode.is(policy)) return i;
      return { ...i, message: `${i.outcome}: ${renderPostgresPolicyReference(policy)}` };
    });
}

/**
 * Filters `extra` policy issues to those in owned namespaces. Call after
 * `diffPostgresSchema` with the union of namespace ids from the expected tree's
 * policies and its `existingSchemas`.
 */
export function filterIssuesByOwnership(
  issues: readonly SchemaDiffIssue[],
  ownedSchemaNameSet: ReadonlySet<string>,
): readonly SchemaDiffIssue[] {
  return issues.filter((i) => {
    if (i.outcome !== 'extra') return true;
    if (i.actual === undefined) return false;
    const policy = asSchemaNode(i.actual);
    return PostgresPolicySchemaNode.is(policy) && ownedSchemaNameSet.has(policy.namespaceId);
  });
}
