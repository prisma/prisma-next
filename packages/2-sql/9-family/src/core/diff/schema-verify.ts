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
  SchemaDiffIssue,
  SchemaSubjectGranularity,
  VerifierIssueCategory,
  VerifierOutcome,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { dispositionForCategory } from '@prisma-next/framework-components/control';
import { isStorageTypeInstance, type SqlStorage } from '@prisma-next/sql-contract/types';
import { RelationalSchemaNodeKind, type SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { extractCodecControlHooks } from '../assembly';
import type { SqlSchemaDiffFn } from '../migrations/schema-differ';
import type { CodecControlHooks } from '../migrations/types';
import { verifierDisposition } from './verifier-disposition';

// ============================================================================
// Subject-granularity stamping — nodeKind → framework-neutral granularity
// ============================================================================

function issueNode(issue: SchemaDiffIssue): SqlSchemaIRNode | undefined {
  const node = issue.expected ?? issue.actual;
  if (node === undefined) return undefined;
  return blindCast<
    SqlSchemaIRNode,
    'every node in a SQL schema diff tree is a SqlSchemaIRNode; nodeKind is its identity'
  >(node);
}

/**
 * Stamps each issue's framework-neutral {@link SchemaSubjectGranularity} onto
 * it, resolved from the issue's node's `nodeKind` via the target-provided
 * `granularityOf` map. Called by the target's differ once it has produced the
 * raw issues — the node carries only its `nodeKind` identity, never a
 * classification, so the granularity every downstream consumer reads (the
 * family verdict here, the framework aggregate's unclaimed-elements sweep)
 * lives on the issue, resolved by the family/target that owns the node
 * vocabulary. An issue with no node is passed through unstamped.
 */
export function stampSubjectGranularity(
  issues: readonly SchemaDiffIssue[],
  granularityOf: (nodeKind: string) => SchemaSubjectGranularity,
): readonly SchemaDiffIssue[] {
  return issues.map((issue) => {
    const node = issueNode(issue);
    if (node === undefined) return issue;
    return { ...issue, subjectGranularity: granularityOf(node.nodeKind) };
  });
}

// ============================================================================
// Issue classification — subject granularity + reason → target-neutral category
// ============================================================================

/**
 * Re-keys the legacy `classifySqlVerifierIssueKind` category mapping on the
 * issue's stamped {@link SchemaSubjectGranularity} + the issue reason. The
 * vocabulary maps one-to-one: an undeclared live entity or namespace is
 * `extraTopLevelObject`, an undeclared live field `extraNestedElement`,
 * undeclared auxiliaries (constraints, indexes, defaults) and structural
 * leaves (policies) `extraAuxiliary`; a value-set drift on a check node is
 * `valueDrift`; every other paired divergence is `declaredIncompatible`;
 * anything the database lacks is `declaredMissing`. The granularity is
 * stamped by the target's differ, so target and extension node kinds
 * classify without the family importing them.
 */
export function classifySqlDiffIssue(issue: SchemaDiffIssue): VerifierIssueCategory {
  if (issue.reason === 'not-found') {
    return 'declaredMissing';
  }
  if (issue.reason === 'not-expected') {
    const granularity = issue.subjectGranularity;
    if (granularity === 'entity' || granularity === 'namespace') {
      return 'extraTopLevelObject';
    }
    if (granularity === 'field') {
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
 * walk detected every relational extra (namespaces, entities, fields, and
 * their auxiliaries) only under `--strict`; the structural diff (roots, RLS
 * policies, roles) was never strict-gated — its extras fail in both modes.
 * Keyed on the issue's stamped granularity.
 */
function isStrictOnlyExtra(issue: SchemaDiffIssue): boolean {
  const granularity = issue.subjectGranularity;
  return (
    granularity === 'namespace' ||
    granularity === 'entity' ||
    granularity === 'field' ||
    granularity === 'auxiliary'
  );
}

// ============================================================================
// The post-diff filter + verdict
// ============================================================================

export interface SqlDiffVerdictInput {
  /** The full, ownership-scoped diff issue list from the target's differ. */
  readonly issues: readonly SchemaDiffIssue[];
  /** Resolves a diff issue's subject table's declared control policy directly from the contract. */
  readonly resolveControlPolicy: (issue: SchemaDiffIssue) => ControlPolicy | undefined;
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
    const tablePolicy = input.resolveControlPolicy(issue);
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
  readonly failures: readonly SchemaDiffIssue[];
  readonly warnings: readonly SchemaDiffIssue[];
}

export function computeStorageTypeVerdict(input: StorageTypeVerdictInput): StorageTypeVerdict {
  const failures: SchemaDiffIssue[] = [];
  const warnings: SchemaDiffIssue[] = [];
  const policy = effectiveControlPolicy(undefined, input.contract.defaultControlPolicy);
  for (const pair of input.namespacePairs) {
    if (pair.actual === undefined) continue;
    for (const [typeName, typeInstance] of Object.entries(input.contract.storage.types ?? {})) {
      if (!isStorageTypeInstance(typeInstance)) continue;
      const hook = input.codecHooks.get(typeInstance.codecId);
      if (!hook?.verifyType) continue;
      const typeIssues = hook.verifyType({ typeName, typeInstance, schema: pair.actual });
      for (const issue of typeIssues) {
        const disposition = verifierDisposition(policy, issue);
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
  /** The target's full-tree node diff (`diffSchema` descriptor hook). */
  readonly diffSchema: SqlSchemaDiffFn;
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
  const verdictDiff = input.diffSchema({
    contract: input.contract,
    schema: input.schema,
    frameworkComponents: input.frameworkComponents,
  });
  const diffVerdict = computeSqlDiffVerdict({
    issues: verdictDiff.issues,
    resolveControlPolicy: verdictDiff.resolveControlPolicy,
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
      issues: [...diffVerdict.failures, ...storageTypeVerdict.failures],
      warnings: {
        issues: [...diffVerdict.warnings, ...storageTypeVerdict.warnings],
      },
    },
    meta: { strict: input.strict },
    timings: { total: Date.now() - startTime },
  };
}
