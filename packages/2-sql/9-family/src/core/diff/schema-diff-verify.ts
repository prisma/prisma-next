/**
 * The differ-based SQL schema verify: post-diff filters and verdict.
 *
 * The generic node differ (`diffSchemas`) reports every node-level
 * difference between the derived expected tree and the introspected actual
 * tree. This module is the consumer side the spec assigns to the SQL
 * family: strict-mode extras gating and control-policy disposition are
 * reason/kind-keyed filters applied AFTER the diff — never inside it — and
 * the verify verdict derives from the filtered issue list.
 *
 * `verifySqlSchemaByDiff` wraps the verdict in the issue-based result
 * envelope — this is THE SQL schema verify (the legacy relational walk and
 * its verification tree are retired).
 */

import type { Contract, ControlPolicy } from '@prisma-next/contract/types';
import { effectiveControlPolicy } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  DiffableNode,
  SchemaDiffIssue,
  SchemaIssue,
  VerifierIssueCategory,
  VerifierOutcome,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { dispositionForCategory } from '@prisma-next/framework-components/control';
import { isStorageTypeInstance, type SqlStorage } from '@prisma-next/sql-contract/types';
import {
  RelationalSchemaNodeKind,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIR,
  type SqlSchemaIRNode,
  SqlTableIR,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { extractCodecControlHooks } from '../assembly';
import type { SqlDiffSchemaForVerdict } from '../migrations/schema-differ';
import type { CodecControlHooks } from '../migrations/types';
import { verifierDisposition } from './verifier-disposition';

// ============================================================================
// Semantic satisfaction — derivation-side normalization of the actual tree
// ============================================================================

export interface SemanticSatisfactionInput {
  readonly expectedUniques: readonly SqlUniqueIR[];
  readonly expectedIndexes: readonly SqlIndexIR[];
  readonly actualUniques: readonly SqlUniqueIR[];
  readonly actualIndexes: readonly SqlIndexIR[];
}

export interface SemanticSatisfactionResult {
  readonly actualUniques: readonly SqlUniqueIR[];
  readonly actualIndexes: readonly SqlIndexIR[];
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/**
 * Adjusts a table pair's ACTUAL unique/index child lists so the legacy
 * walk's cross-kind semantic satisfaction materializes as same-kind node
 * pairs for the differ (the differ pairs strictly by id, so a `unique:`
 * node can never pair with an `index:` node). Three legacy rules, ported
 * from `isUniqueConstraintSatisfied` / `isIndexSatisfied` and the
 * strict-extras loops of the retired relational walk:
 *
 * 1. A contract unique satisfied by a live unique INDEX: the actual index
 *    node is reclassified as a unique node (it pairs with the expected
 *    unique and stops being a candidate extra).
 * 2. A contract index (with no type/options demands) satisfied by a live
 *    unique CONSTRAINT: a same-kind actual index node is synthesized so
 *    the expected index pairs — the unique constraint itself stays (the
 *    legacy strict-extras loop still reports it as an undeclared unique).
 * 3. Live unique indexes are never extras in the legacy walk (its
 *    strict-extras loop skips `unique: true` rows), so any remaining
 *    actual unique-index node with no expected index counterpart is
 *    dropped rather than surfacing as `not-expected`.
 */
export function resolveSemanticSatisfaction(
  input: SemanticSatisfactionInput,
): SemanticSatisfactionResult {
  let actualIndexes = [...input.actualIndexes];
  const actualUniques = [...input.actualUniques];

  // Rule 1: reclassify a satisfying unique index as the unique constraint
  // the contract declared.
  for (const expectedUnique of input.expectedUniques) {
    const alreadyPaired = actualUniques.some((u) => sameColumns(u.columns, expectedUnique.columns));
    if (alreadyPaired) continue;
    const satisfyingIndex = actualIndexes.find(
      (idx) => idx.unique && sameColumns(idx.columns, expectedUnique.columns),
    );
    if (satisfyingIndex) {
      actualIndexes = actualIndexes.filter((idx) => idx !== satisfyingIndex);
      actualUniques.push(
        new SqlUniqueIR({
          columns: satisfyingIndex.columns,
          ...(satisfyingIndex.name !== undefined ? { name: satisfyingIndex.name } : {}),
        }),
      );
    }
  }

  // Rule 2: synthesize an index node from a satisfying unique constraint.
  for (const expectedIndex of input.expectedIndexes) {
    if (expectedIndex.type !== undefined || expectedIndex.options !== undefined) continue;
    const alreadyPaired = actualIndexes.some((idx) =>
      sameColumns(idx.columns, expectedIndex.columns),
    );
    if (alreadyPaired) continue;
    const satisfyingUnique = actualUniques.find((u) =>
      sameColumns(u.columns, expectedIndex.columns),
    );
    if (satisfyingUnique) {
      actualIndexes.push(new SqlIndexIR({ columns: satisfyingUnique.columns, unique: false }));
    }
  }

  // Rule 3: remaining unique indexes with no expected counterpart are
  // invisible to the legacy extras loop — drop them.
  actualIndexes = actualIndexes.filter(
    (idx) =>
      !idx.unique || input.expectedIndexes.some((exp) => sameColumns(exp.columns, idx.columns)),
  );

  return { actualUniques, actualIndexes };
}

// ============================================================================
// Issue classification — declared node role + reason → target-neutral category
// ============================================================================

function issueNode(issue: SchemaDiffIssue): SqlSchemaIRNode | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return blindCast<
    SqlSchemaIRNode,
    'every node in a SQL schema diff tree is a SqlSchemaIRNode; diffRole/nodeKind are its required discriminants'
  >(node);
}

/**
 * Re-keys the legacy `classifySqlVerifierIssueKind` category mapping on the
 * diff node's declared `diffRole` + the issue reason. The vocabulary maps
 * one-to-one: an undeclared live table or namespace is
 * `extraTopLevelObject`, an undeclared live column `extraNestedElement`,
 * undeclared auxiliaries (constraints, indexes, defaults) and structural
 * leaves (policies) `extraAuxiliary`; a value-set drift on a check node is
 * `valueDrift`; every other paired divergence is `declaredIncompatible`;
 * anything the database lacks is `declaredMissing`. `diffRole` is declared
 * per node class, so target and extension node kinds classify without the
 * family importing them.
 */
export function classifySqlDiffIssue(issue: SchemaDiffIssue): VerifierIssueCategory {
  if (issue.reason === 'not-found') {
    return 'declaredMissing';
  }
  if (issue.reason === 'not-expected') {
    const role = issueNode(issue)?.diffRole;
    if (role === 'table' || role === 'namespace') {
      return 'extraTopLevelObject';
    }
    if (role === 'column') {
      return 'extraNestedElement';
    }
    return 'extraAuxiliary';
  }
  if (issueNode(issue)?.nodeKind === RelationalSchemaNodeKind.check) {
    return 'valueDrift';
  }
  return 'declaredIncompatible';
}

/**
 * Whether a `not-expected` issue is a strict-mode-only finding. The legacy
 * walk detected every relational extra (namespaces, tables, columns, and
 * their auxiliaries) only under `--strict`; the structural diff (roots, RLS
 * policies, roles) was never strict-gated — its extras fail in both modes.
 * Keyed on the node's declared `diffRole`.
 */
function isStrictOnlyExtra(issue: SchemaDiffIssue): boolean {
  const role = issueNode(issue)?.diffRole;
  return role === 'namespace' || role === 'table' || role === 'column' || role === 'auxiliary';
}

// ============================================================================
// Control-policy resolution — walk the expected tree along the issue path
// ============================================================================

function tableControlPolicyForPath(
  expectedRoot: DiffableNode,
  path: readonly string[],
): ControlPolicy | undefined {
  let current: DiffableNode | undefined = expectedRoot;
  let policy: ControlPolicy | undefined;
  // path[0] is the root's own id.
  for (const segment of path.slice(1)) {
    current = current?.children().find((child) => child.id === segment);
    if (current === undefined) break;
    const stamped = blindCast<
      { readonly controlPolicy?: ControlPolicy },
      'structural read of the optional controlPolicy field derivation stamps on expected table nodes'
    >(current).controlPolicy;
    if (stamped !== undefined) {
      policy = stamped;
    }
  }
  return policy;
}

// ============================================================================
// The post-diff filter + verdict
// ============================================================================

export interface SqlDiffVerdictInput {
  /** The full, ownership-scoped diff issue list from the target's differ. */
  readonly issues: readonly SchemaDiffIssue[];
  /** The expected tree the diff ran over (control-policy resolution). */
  readonly expectedRoot: DiffableNode;
  readonly strict: boolean;
  readonly defaultControlPolicy: ControlPolicy | undefined;
}

export interface SqlDiffVerdict {
  readonly failures: readonly SchemaDiffIssue[];
  readonly warnings: readonly SchemaDiffIssue[];
}

/**
 * Applies the two consumer filters to a diff issue list: strict gating
 * (relational `not-expected` findings drop in lenient mode) and
 * control-policy disposition (each surviving issue grades against its
 * subject table's effective policy; suppressed issues drop, `observed`
 * subjects warn). The verify verdict is `failures.length === 0`.
 */
export function computeSqlDiffVerdict(input: SqlDiffVerdictInput): SqlDiffVerdict {
  const failures: SchemaDiffIssue[] = [];
  const warnings: SchemaDiffIssue[] = [];
  for (const issue of input.issues) {
    if (!input.strict && issue.reason === 'not-expected' && isStrictOnlyExtra(issue)) {
      continue;
    }
    const tablePolicy = tableControlPolicyForPath(input.expectedRoot, issue.path);
    const policy = effectiveControlPolicy(tablePolicy, input.defaultControlPolicy);
    const disposition: VerifierOutcome = dispositionForCategory(
      policy,
      classifySqlDiffIssue(issue),
    );
    if (disposition === 'suppress') continue;
    if (disposition === 'warn') {
      warnings.push(issue);
      continue;
    }
    failures.push(issue);
  }
  return { failures, warnings };
}

// ============================================================================
// Storage-types check — the codec verifyType hook path
// ============================================================================

export interface StorageTypeVerdictInput {
  readonly contract: Contract<SqlStorage>;
  /**
   * Expected/actual namespace-node pairs the target's differ input produced:
   * for a namespaced tree, one entry per expected namespace with a
   * non-empty table set, paired by DDL schema name (absent actual side for
   * a schema the database lacks); a flat tree is the sole pair.
   */
  readonly namespacePairs: ReadonlyArray<{
    readonly actual: SqlSchemaIRNode | undefined;
  }>;
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
}

/**
 * Runs the codec `verifyType` hooks the way the legacy walk did: once per
 * contract namespace with tables, against that namespace's paired actual
 * node (the hook reads namespace-scoped state such as
 * `nativeEnumTypeNames` off it). Issue dispositions grade against the
 * contract default policy, matching the legacy `pushTypeNode` semantics.
 */
export interface StorageTypeVerdict {
  readonly failures: readonly SchemaIssue[];
  readonly warnings: readonly SchemaIssue[];
}

export function computeStorageTypeVerdict(input: StorageTypeVerdictInput): StorageTypeVerdict {
  const failures: SchemaIssue[] = [];
  const warnings: SchemaIssue[] = [];
  const policy = effectiveControlPolicy(undefined, input.contract.defaultControlPolicy);
  for (const pair of input.namespacePairs) {
    if (pair.actual === undefined) continue;
    for (const [typeName, typeInstance] of Object.entries(input.contract.storage.types ?? {})) {
      if (!isStorageTypeInstance(typeInstance)) continue;
      const hook = input.codecHooks.get(typeInstance.codecId);
      if (!hook?.verifyType) continue;
      const typeIssues = hook.verifyType({ typeName, typeInstance, schema: pair.actual });
      for (const issue of typeIssues) {
        const disposition = verifierDisposition(policy, issue.kind);
        if (disposition === 'suppress') continue;
        if (disposition === 'warn') {
          warnings.push(issue);
          continue;
        }
        failures.push(issue);
      }
    }
  }
  return { failures, warnings };
}

// ============================================================================
// The issue-based verify envelope
// ============================================================================

export interface VerifySqlSchemaByDiffInput {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIRNode;
  readonly strict: boolean;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  /** The target's full-tree node diff (`diffSchemaForVerdict` descriptor hook). */
  readonly diffSchemaForVerdict: SqlDiffSchemaForVerdict;
}

/**
 * THE SQL schema verify: runs the target's full-tree node diff, grades it
 * through the family's post-diff filters (strict gating + control-policy
 * disposition) plus the codec `verifyType` hook findings, and wraps the
 * verdict in the issue-based result envelope. `ok` holds exactly when both
 * issue lists are empty — the lists carry the verdict's failures.
 */
export function verifySqlSchemaByDiff(
  input: VerifySqlSchemaByDiffInput,
): VerifyDatabaseSchemaResult {
  const startTime = Date.now();
  const verdictDiff = input.diffSchemaForVerdict({
    contract: input.contract,
    schema: input.schema,
    frameworkComponents: input.frameworkComponents,
  });
  const diffVerdict = computeSqlDiffVerdict({
    issues: verdictDiff.issues,
    expectedRoot: verdictDiff.expectedRoot,
    strict: input.strict,
    defaultControlPolicy: input.contract.defaultControlPolicy,
  });
  const storageTypeVerdict = computeStorageTypeVerdict({
    contract: input.contract,
    namespacePairs: verdictDiff.namespacePairs,
    codecHooks: extractCodecControlHooks(input.frameworkComponents),
  });
  const failCount = diffVerdict.failures.length + storageTypeVerdict.failures.length;
  const ok = failCount === 0;
  const profileHash =
    'profileHash' in input.contract && typeof input.contract.profileHash === 'string'
      ? input.contract.profileHash
      : undefined;
  return {
    ok,
    ...(ok ? {} : { code: 'PN-SCHEMA-0001' }),
    summary: ok
      ? 'Database schema satisfies contract'
      : `Database schema does not satisfy contract (${failCount} failure${failCount === 1 ? '' : 's'})`,
    contract: {
      storageHash: input.contract.storage.storageHash,
      ...ifDefined('profileHash', profileHash),
    },
    target: {
      expected: input.contract.target,
      actual: input.contract.target,
    },
    schema: {
      issues: storageTypeVerdict.failures,
      schemaDiffIssues: diffVerdict.failures,
      warnings: {
        issues: storageTypeVerdict.warnings,
        schemaDiffIssues: diffVerdict.warnings,
      },
    },
    meta: { strict: input.strict },
    timings: { total: Date.now() - startTime },
  };
}

// ============================================================================
// Flat-tree helpers (single-schema targets)
// ============================================================================

/**
 * Applies {@link resolveSemanticSatisfaction} across a flat table pair set:
 * every actual table with an expected counterpart gets its unique/index
 * child lists adjusted; unpaired tables pass through untouched.
 */
export function normalizeFlatActualForDiff(
  expected: SqlSchemaIR,
  actual: SqlSchemaIR,
): SqlSchemaIR {
  const tables: Record<string, SqlTableIR> = {};
  for (const [name, actualTable] of Object.entries(actual.tables)) {
    const expectedTable = expected.tables[name];
    if (expectedTable === undefined) {
      tables[name] = actualTable;
      continue;
    }
    const adjusted = resolveSemanticSatisfaction({
      expectedUniques: expectedTable.uniques,
      expectedIndexes: expectedTable.indexes,
      actualUniques: actualTable.uniques,
      actualIndexes: actualTable.indexes,
    });
    tables[name] = new SqlTableIR({
      name: actualTable.name,
      columns: actualTable.columns,
      foreignKeys: actualTable.foreignKeys,
      uniques: adjusted.actualUniques,
      indexes: adjusted.actualIndexes,
      ...(actualTable.primaryKey !== undefined ? { primaryKey: actualTable.primaryKey } : {}),
      ...(actualTable.annotations !== undefined ? { annotations: actualTable.annotations } : {}),
      ...(actualTable.checks !== undefined ? { checks: actualTable.checks } : {}),
    });
  }
  return new SqlSchemaIR({
    tables,
    ...(actual.annotations !== undefined ? { annotations: actual.annotations } : {}),
  });
}

/**
 * Neutralizes the FK schema segment on a flat expected tree so its FK diff
 * nodes pair with introspected FKs on single-schema targets: the family
 * converter stamps `referencedSchema` with the contract namespace id
 * verbatim (the unbound sentinel on non-namespaced targets), while a
 * single-schema introspection stamps none — resolving both sides to the
 * empty segment makes the ids meet.
 */
export function neutralizeFlatExpectedFkSchemas(expected: SqlSchemaIR): SqlSchemaIR {
  const tables: Record<string, SqlTableIR> = {};
  for (const [name, table] of Object.entries(expected.tables)) {
    if (table.foreignKeys.length === 0) {
      tables[name] = table;
      continue;
    }
    const foreignKeys = table.foreignKeys.map(
      (fk) =>
        new SqlForeignKeyIR({
          columns: fk.columns,
          referencedTable: fk.referencedTable,
          referencedColumns: fk.referencedColumns,
          ...(fk.referencedSchema !== undefined ? { referencedSchema: fk.referencedSchema } : {}),
          ...(fk.name !== undefined ? { name: fk.name } : {}),
          ...(fk.onDelete !== undefined ? { onDelete: fk.onDelete } : {}),
          ...(fk.onUpdate !== undefined ? { onUpdate: fk.onUpdate } : {}),
          ...(fk.annotations !== undefined ? { annotations: fk.annotations } : {}),
          resolvedReferencedSchema: '',
        }),
    );
    tables[name] = new SqlTableIR({
      name: table.name,
      columns: table.columns,
      foreignKeys,
      uniques: table.uniques,
      indexes: table.indexes,
      ...(table.primaryKey !== undefined ? { primaryKey: table.primaryKey } : {}),
      ...(table.annotations !== undefined ? { annotations: table.annotations } : {}),
      ...(table.checks !== undefined ? { checks: table.checks } : {}),
      ...(table.controlPolicy !== undefined ? { controlPolicy: table.controlPolicy } : {}),
    });
  }
  return new SqlSchemaIR({
    tables,
    ...(expected.annotations !== undefined ? { annotations: expected.annotations } : {}),
  });
}
