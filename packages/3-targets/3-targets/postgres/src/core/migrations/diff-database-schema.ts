import type { Contract, ControlPolicy } from '@prisma-next/contract/types';
import type { SqlSchemaDiffResult } from '@prisma-next/family-sql/control';
import { buildNativeTypeExpander } from '@prisma-next/family-sql/control';
import { resolveSemanticSatisfaction } from '@prisma-next/family-sql/diff';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type { SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { diffSchemas } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import type { PostgresContract } from '../postgres-schema';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import type { SqlSchemaDiffNode } from '../schema-ir/schema-node-kinds';
import { contractToPostgresDatabaseSchemaNode } from './contract-to-postgres-database-schema-node';
import { resolvePostgresNodeIssueControlPolicySubject } from './control-policy';

function ownedSchemaNames(expected: PostgresDatabaseSchemaNode): ReadonlySet<string> {
  const policyNamespaces = Object.values(expected.namespaces).flatMap((ns) =>
    Object.values(ns.tables).flatMap((t) => t.policies.map((p) => p.namespaceId)),
  );
  return new Set([...policyNamespaces, ...expected.existingSchemas]);
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
 * Drops contract namespaces that declare no tables from the verdict-diff
 * expected tree and the relational owned-schema set. The legacy relational
 * walk skipped a table-less namespace (e.g. an enums-only schema) before
 * pairing, so neither its DDL schema's absence nor that schema's live
 * relational contents ever reached the verdict — the pruned tree
 * reproduces that. The prune loses no expected policies: policies attach
 * to tables, so a table-less namespace carries none (the projection
 * throws on a policy referencing an absent table). Live policies in a
 * pruned schema remain governed via the full owned set (see
 * {@link diffPostgresSchema}).
 */
function pruneTableLessNamespaces(
  expected: PostgresDatabaseSchemaNode,
): PostgresDatabaseSchemaNode {
  const namespaces = Object.fromEntries(
    Object.entries(expected.namespaces).filter(([, ns]) => Object.keys(ns.tables).length > 0),
  );
  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles: [...expected.roles],
    existingSchemas: expected.existingSchemas.filter((s) => namespaces[s] !== undefined),
    pgVersion: expected.pgVersion,
  });
}

/**
 * Resolves a verdict-diff issue's subject table's declared control policy
 * directly from the contract, by delegating to the same node-typed resolver
 * ({@link resolvePostgresNodeIssueControlPolicySubject}) the planner uses to
 * gate DDL calls. `undefined` when the issue resolves to no contract table.
 */
function resolveControlPolicy(
  issue: SchemaDiffIssue,
  contract: Contract<SqlStorage>,
): ControlPolicy | undefined {
  const nodeIssue = blindCast<
    SchemaDiffIssue<SqlSchemaDiffNode>,
    'every node in a Postgres schema diff tree is a SqlSchemaDiffNode'
  >(issue);
  return resolvePostgresNodeIssueControlPolicySubject(nodeIssue, contract)
    ?.explicitNodeControlPolicy;
}

/**
 * The Postgres full-tree node diff for the family verify verdict: derive
 * the expected tree (resolved leaf values, expander threaded, FK schemas
 * resolved, table-less namespaces pruned), normalize the actual tree for
 * semantic satisfaction, run the generic
 * differ, and scope out `not-expected` findings under namespaces the
 * contract does not own. Ownership is role-aware, mirroring the legacy
 * decomposition: relational extras check the PRUNED owned set (the legacy
 * per-namespace walk never visited a table-less namespace, so its live
 * relational contents are invisible), while `structural` extras (RLS
 * policies) check the FULL owned set (the legacy policy diff governed
 * every contract schema regardless of tables — RLS governance does not
 * shrink because a namespace declares no tables). The codec `verifyType`
 * hooks run once per contract namespace with tables against that
 * namespace's paired actual node (the hooks read namespace-scoped state
 * such as `nativeEnumTypeNames`).
 */
export function diffPostgresSchema(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): SqlSchemaDiffResult {
  const postgresContract = blindCast<
    PostgresContract,
    'diffPostgresSchema is only called with a postgres contract'
  >(input.contract);
  PostgresDatabaseSchemaNode.assert(input.schema);
  const actual = input.schema;
  const expandNativeType = buildNativeTypeExpander(input.frameworkComponents);
  const fullExpected = contractToPostgresDatabaseSchemaNode(postgresContract, {
    annotationNamespace: 'pg',
    ...ifDefined('expandNativeType', expandNativeType),
  });
  const expected = pruneTableLessNamespaces(fullExpected);
  const normalizedActual = normalizePostgresActualForDiff(expected, actual);
  const relationalOwned = ownedSchemaNames(expected);
  const structuralOwned = ownedSchemaNames(fullExpected);
  const issues = diffSchemas(expected, normalizedActual).filter((issue) => {
    if (issue.reason !== 'not-expected') return true;
    const namespaceSegment = issue.path[1];
    if (namespaceSegment === undefined) return true;
    const node = blindCast<
      SqlSchemaIRNode | undefined,
      'every node in a Postgres schema diff tree is a SqlSchemaIRNode; diffRole is its required discriminant'
    >(issue.actual ?? issue.expected);
    const owned = node?.diffRole === 'structural' ? structuralOwned : relationalOwned;
    return owned.has(namespaceSegment);
  });
  const namespacePairs = Object.values(expected.namespaces).map((ns) => ({
    actual: actual.namespaces[ns.schemaName],
  }));
  return {
    issues,
    resolveControlPolicy: (issue) => resolveControlPolicy(issue, postgresContract),
    namespacePairs,
  };
}

/**
 * Adds an empty namespace node to the actual tree for every expected namespace
 * absent from it. The relational plan diff pairs on namespace: a contract
 * namespace whose live schema does not exist yet must surface each of its
 * tables as `not-found` (→ `CREATE TABLE`), NOT as a single namespace
 * `not-found` that subtree-coalescing would collapse (leaving `CREATE SCHEMA`
 * with no tables). Padding makes the namespaces pair, so only table/column/
 * policy drift surfaces; `CREATE SCHEMA` comes separately from the synthesized
 * namespace-presence stitch (`verifyPostgresNamespacePresence`), never from the
 * tree diff — matching the retired per-namespace-paired relational walk, which
 * paired a missing schema against an empty namespace node.
 */
function padActualNamespaces(
  expected: PostgresDatabaseSchemaNode,
  actual: PostgresDatabaseSchemaNode,
): PostgresDatabaseSchemaNode {
  const namespaces: Record<string, PostgresNamespaceSchemaNode> = { ...actual.namespaces };
  let padded = false;
  for (const schemaName of Object.keys(expected.namespaces)) {
    if (namespaces[schemaName] === undefined) {
      namespaces[schemaName] = new PostgresNamespaceSchemaNode({
        schemaName,
        tables: {},
        nativeEnumTypeNames: [],
      });
      padded = true;
    }
  }
  if (!padded) return actual;
  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles: [...actual.roles],
    existingSchemas: [...actual.existingSchemas],
    pgVersion: actual.pgVersion,
  });
}

export interface PostgresPlanDiff {
  /** The desired ("end") tree — resolved leaf values (incl. `codecRef`) on every column, table-less namespaces pruned. */
  readonly expected: PostgresDatabaseSchemaNode;
  /** The live ("start") tree, padded with empty namespaces and normalized for semantic satisfaction against `expected`. */
  readonly actual: PostgresDatabaseSchemaNode;
  /** The one node diff over the two trees: relational + policy drift, role-aware ownership filtered. */
  readonly issues: readonly SchemaDiffIssue<SqlSchemaDiffNode>[];
}

/**
 * The Postgres planner's diff input: the SAME tree-building
 * `diffPostgresSchema` uses (expander threaded, FK schemas resolved,
 * table-less namespaces pruned, actual normalized for semantic satisfaction,
 * role-aware ownership filter) plus actual namespace padding (so a missing
 * schema's tables surface as `not-found` instead of a swallowed namespace
 * `not-found`). One differ drives both verify and plan; this is the
 * plan-side derivation. The single issue list covers tables / columns /
 * constraints / indexes / defaults AND policies — the caller splits it
 * (relational → `mapNodeIssueToCall`; policy → RLS ops) and stitches in
 * `CREATE SCHEMA` separately.
 */
export function buildPostgresPlanDiff(input: {
  readonly contract: Contract<SqlStorage>;
  readonly actualSchema: SqlSchemaIRNode;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
}): PostgresPlanDiff {
  const postgresContract = blindCast<
    PostgresContract,
    'buildPostgresPlanDiff is only called with a postgres contract'
  >(input.contract);
  PostgresDatabaseSchemaNode.assert(input.actualSchema);
  const actual = input.actualSchema;
  const expandNativeType = buildNativeTypeExpander(input.frameworkComponents);
  const projectionOptions = {
    annotationNamespace: 'pg',
    ...ifDefined('expandNativeType', expandNativeType),
  };
  const fullExpected = contractToPostgresDatabaseSchemaNode(postgresContract, projectionOptions);
  const expected = pruneTableLessNamespaces(fullExpected);
  const paddedActual = padActualNamespaces(expected, actual);
  const normalizedActual = normalizePostgresActualForDiff(expected, paddedActual);
  const relationalOwned = ownedSchemaNames(expected);
  const structuralOwned = ownedSchemaNames(fullExpected);
  const issues = blindCast<
    readonly SchemaDiffIssue<SqlSchemaDiffNode>[],
    'both trees are PostgresDatabaseSchemaNodes, so every diff-issue node is a SqlSchemaDiffNode'
  >(diffSchemas(expected, normalizedActual)).filter((issue) => {
    if (issue.reason !== 'not-expected') return true;
    const namespaceSegment = issue.path[1];
    if (namespaceSegment === undefined) return true;
    const node = issue.actual ?? issue.expected;
    const owned = node?.diffRole === 'structural' ? structuralOwned : relationalOwned;
    return owned.has(namespaceSegment);
  });
  return { expected, actual: normalizedActual, issues };
}
