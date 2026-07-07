import type { Contract } from '@prisma-next/contract/types';
import type { SqlSchemaDiffForVerdict } from '@prisma-next/family-sql/control';
import { buildNativeTypeExpander } from '@prisma-next/family-sql/control';
import { resolveSemanticSatisfaction, verifySqlSchemaTree } from '@prisma-next/family-sql/diff';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { diffSchemas, SchemaDiff } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { parsePostgresDefault } from '../default-normalizer';
import { normalizeSchemaNativeType } from '../native-type-normalizer';
import type { PostgresContract } from '../postgres-schema';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import type { SqlSchemaDiffNode } from '../schema-ir/schema-node-kinds';
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
  readonly schemaDiffIssues: readonly SchemaDiffIssue<SqlSchemaDiffNode>[];
} {
  const postgresContract = blindCast<
    PostgresContract,
    'diffPostgresDatabaseSchema is only called with a postgres contract'
  >(input.contract);

  // The expected trees stamp resolved values onto their leaf nodes (resolved
  // native types via the codec expandNativeType hooks, structured defaults,
  // resolved FK schemas) so leaves are comparable against the introspected
  // side. The legacy relational walk below does not read them — it verifies
  // from the contract directly and self-normalizes.
  const expandNativeType = buildNativeTypeExpander(input.frameworkComponents);
  const projectionOptions = {
    annotationNamespace: 'pg',
    ...ifDefined('expandNativeType', expandNativeType),
  };

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
        projectionOptions,
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
  const expected = contractToPostgresDatabaseSchemaNode(postgresContract, projectionOptions);
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
export function diffPostgresDatabaseSchema(
  input: PostgresDiffDatabaseSchemaInput,
): SchemaDiff<SqlSchemaDiffNode> {
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
 * Both trees are `PostgresDatabaseSchemaNode`s, so every issue node is a
 * `SqlSchemaDiffNode` — narrow the framework's `SchemaDiffIssue<DiffableNode>`
 * output once here (the single boundary cast), so every downstream consumer
 * (the ownership filter, the planner) reads the concrete node with no cast.
 *
 * Ownership filtering (dropping `extra` issues in namespaces a contract doesn't
 * own) is the caller's responsibility — use `filterIssuesByOwnership`.
 */
export function diffPostgresSchema(
  expected: PostgresDatabaseSchemaNode,
  actual: PostgresDatabaseSchemaNode,
): readonly SchemaDiffIssue<SqlSchemaDiffNode>[] {
  const issues = blindCast<
    readonly SchemaDiffIssue<SqlSchemaDiffNode>[],
    'both trees are PostgresDatabaseSchemaNodes, so every diff-issue node is a SqlSchemaDiffNode'
  >(diffSchemas(expected, actual));

  return issues
    .filter((i) => {
      const node = i.expected ?? i.actual;
      return node !== undefined && PostgresPolicySchemaNode.is(node);
    })
    .map((i) => {
      const node = i.expected ?? i.actual;
      if (node === undefined || !PostgresPolicySchemaNode.is(node)) return i;
      return { ...i, message: `${i.outcome}: ${renderPostgresPolicyReference(node)}` };
    });
}

/**
 * Filters `extra` policy issues to those in owned namespaces. Call after
 * `diffPostgresSchema` with the union of namespace ids from the expected tree's
 * policies and its `existingSchemas`.
 */
export function filterIssuesByOwnership(
  issues: readonly SchemaDiffIssue<SqlSchemaDiffNode>[],
  ownedSchemaNameSet: ReadonlySet<string>,
): readonly SchemaDiffIssue<SqlSchemaDiffNode>[] {
  return issues.filter((i) => {
    if (i.outcome !== 'extra') return true;
    if (i.actual === undefined) return false;
    return PostgresPolicySchemaNode.is(i.actual) && ownedSchemaNameSet.has(i.actual.namespaceId);
  });
}

/**
 * Applies the family's semantic-satisfaction normalization across a Postgres
 * tree pair: every actual table with an expected counterpart (paired by
 * namespace id, then table id) gets its unique/index child lists adjusted;
 * everything else passes through untouched.
 */
export function normalizePostgresActualForDiff(
  expected: PostgresDatabaseSchemaNode,
  actual: PostgresDatabaseSchemaNode,
): PostgresDatabaseSchemaNode {
  const namespaces: Record<string, PostgresNamespaceSchemaNode> = {};
  for (const [nsId, actualNs] of Object.entries(actual.namespaces)) {
    const expectedNs = expected.namespaces[nsId];
    if (expectedNs === undefined) {
      namespaces[nsId] = actualNs;
      continue;
    }
    const tables: Record<string, PostgresTableSchemaNode> = {};
    for (const [tableName, actualTable] of Object.entries(actualNs.tables)) {
      const expectedTable = expectedNs.tables[tableName];
      if (expectedTable === undefined) {
        tables[tableName] = actualTable;
        continue;
      }
      const adjusted = resolveSemanticSatisfaction({
        expectedUniques: expectedTable.uniques,
        expectedIndexes: expectedTable.indexes,
        actualUniques: actualTable.uniques,
        actualIndexes: actualTable.indexes,
      });
      tables[tableName] = new PostgresTableSchemaNode({
        name: actualTable.name,
        columns: actualTable.columns,
        foreignKeys: actualTable.foreignKeys,
        uniques: adjusted.actualUniques,
        indexes: adjusted.actualIndexes,
        ...ifDefined('primaryKey', actualTable.primaryKey),
        ...ifDefined('annotations', actualTable.annotations),
        ...ifDefined('checks', actualTable.checks),
        policies: [...actualTable.policies],
      });
    }
    namespaces[nsId] = new PostgresNamespaceSchemaNode({
      schemaName: actualNs.schemaName,
      tables,
      nativeEnumTypeNames: actualNs.nativeEnumTypeNames,
    });
  }
  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles: [...actual.roles],
    existingSchemas: [...actual.existingSchemas],
    pgVersion: actual.pgVersion,
  });
}

/**
 * The Postgres full-tree node diff for the family verify verdict: derive
 * the expected tree (resolved leaf values, expander threaded, FK schemas
 * resolved, table control policies stamped), normalize the actual tree for
 * semantic satisfaction, run the generic differ, and scope out
 * `not-expected` findings under namespaces the contract does not own — the
 * legacy per-namespace walk never visited unowned schemas, so their
 * contents are invisible to verify. The codec `verifyType` hooks run once
 * per contract namespace with tables against that namespace's paired
 * actual node (the hooks read namespace-scoped state such as
 * `nativeEnumTypeNames`).
 */
export function diffPostgresSchemaForVerdict(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): SqlSchemaDiffForVerdict {
  const postgresContract = blindCast<
    PostgresContract,
    'diffPostgresSchemaForVerdict is only called with a postgres contract'
  >(input.contract);
  PostgresDatabaseSchemaNode.assert(input.schema);
  const actual = input.schema;
  const expandNativeType = buildNativeTypeExpander(input.frameworkComponents);
  const expected = contractToPostgresDatabaseSchemaNode(postgresContract, {
    annotationNamespace: 'pg',
    ...ifDefined('expandNativeType', expandNativeType),
  });
  const normalizedActual = normalizePostgresActualForDiff(expected, actual);
  const owned = ownedSchemaNames(expected);
  const issues = diffSchemas(expected, normalizedActual).filter((issue) => {
    if (issue.reason !== 'not-expected') return true;
    const namespaceSegment = issue.path[1];
    return namespaceSegment === undefined || owned.has(namespaceSegment);
  });
  const namespacePairs = Object.values(expected.namespaces)
    .filter((ns) => Object.keys(ns.tables).length > 0)
    .map((ns) => ({ actual: actual.namespaces[ns.schemaName] }));
  return { issues, expectedRoot: expected, namespacePairs };
}
