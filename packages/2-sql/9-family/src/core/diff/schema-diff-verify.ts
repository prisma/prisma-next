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
 * The legacy relational walk (`verifySqlSchema`) remains alive alongside
 * for rendered output until the tree-view cut; this module must produce the
 * identical verdict for every scenario the walk grades (pinned by the
 * differ-parity suite).
 */

import type { Contract, ControlPolicy } from '@prisma-next/contract/types';
import { effectiveControlPolicy } from '@prisma-next/contract/types';
import type {
  DiffableNode,
  SchemaDiffIssue,
  SchemaIssue,
  VerifierIssueCategory,
  VerifierOutcome,
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
 * strict-extras loops in the merge-base `verify-helpers.ts`:
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
// Issue classification — node kind + reason → target-neutral category
// ============================================================================

function issueNodeKind(issue: SchemaDiffIssue): string | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return blindCast<
    SqlSchemaIRNode,
    'every node in a SQL schema diff tree is a SqlSchemaIRNode; nodeKind is its required discriminant'
  >(node).nodeKind;
}

/**
 * Re-keys the legacy `classifySqlVerifierIssueKind` category mapping on the
 * diff node's kind + the issue reason. The relational vocabulary maps
 * one-to-one: an undeclared live table is `extraTopLevelObject`, an
 * undeclared live column `extraNestedElement`, undeclared constraints,
 * defaults, and policies `extraAuxiliary`; a value-set drift on a check
 * node is `valueDrift`; every other paired divergence is
 * `declaredIncompatible`; anything the database lacks is `declaredMissing`.
 * Target node kinds (policies, namespaces, tables of a namespaced tree)
 * classify by their kind-name suffix so the family stays free of target
 * imports.
 */
export function classifySqlDiffIssue(issue: SchemaDiffIssue): VerifierIssueCategory {
  const nodeKind = issueNodeKind(issue) ?? '';
  if (issue.reason === 'not-found') {
    return 'declaredMissing';
  }
  if (issue.reason === 'not-expected') {
    if (nodeKind === RelationalSchemaNodeKind.table || nodeKind.endsWith('-table')) {
      return 'extraTopLevelObject';
    }
    if (nodeKind === RelationalSchemaNodeKind.column || nodeKind.endsWith('-column')) {
      return 'extraNestedElement';
    }
    if (nodeKind.endsWith('-namespace')) {
      return 'extraTopLevelObject';
    }
    return 'extraAuxiliary';
  }
  if (nodeKind === RelationalSchemaNodeKind.check) {
    return 'valueDrift';
  }
  return 'declaredIncompatible';
}

/**
 * Whether a `not-expected` issue is a strict-mode-only finding. The legacy
 * walk detected every relational extra (tables, columns, constraints,
 * indexes, defaults, checks) only under `--strict`; the structural policy
 * diff (RLS policies) was never strict-gated — its extras fail in both
 * modes. Relational node kinds gate; target kinds (policies) do not.
 */
function isStrictOnlyExtra(issue: SchemaDiffIssue): boolean {
  const nodeKind = issueNodeKind(issue) ?? '';
  const relationalKinds: readonly string[] = Object.values(RelationalSchemaNodeKind);
  if (relationalKinds.includes(nodeKind)) return true;
  // Namespaced target trees reuse the same relational grammar for their
  // table nodes; gate those identically.
  return nodeKind.endsWith('-table') || nodeKind.endsWith('-namespace');
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
export function computeStorageTypeVerdict(input: StorageTypeVerdictInput): SqlDiffVerdict {
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
  // Storage-type issues keep the legacy coordinate shape until the
  // one-issue-type merge; the verdict only needs their counts, so they ride
  // in the diff-issue lists as opaque failures via a structural lift.
  return {
    failures: blindCast<
      readonly SchemaDiffIssue[],
      'W3 interim: legacy-typed storage-type issues counted into the verdict; the one-issue-type merge is a later unit'
    >(failures),
    warnings: blindCast<
      readonly SchemaDiffIssue[],
      'W3 interim: legacy-typed storage-type issues counted into the verdict; the one-issue-type merge is a later unit'
    >(warnings),
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
