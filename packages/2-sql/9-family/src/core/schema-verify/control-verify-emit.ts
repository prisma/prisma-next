import type { ControlPolicy } from '@prisma-next/contract/types';
import type {
  SchemaIssue,
  SchemaVerificationNode,
  VerifierOutcome,
} from '@prisma-next/framework-components/control';
import { verifierDisposition } from '@prisma-next/framework-components/control';

/**
 * Grades `issue` under `controlPolicy` and, unless suppressed, pushes both the
 * issue and a status-stamped verification node. Returns the resolved outcome so
 * the caller never re-grades the same issue.
 */
export function emitIssueAndNodeUnderControlPolicy(
  controlPolicy: ControlPolicy,
  issue: SchemaIssue,
  node: SchemaVerificationNode,
  issues: SchemaIssue[],
  nodes: SchemaVerificationNode[],
): VerifierOutcome {
  const disposition = verifierDisposition(controlPolicy, issue.kind);
  if (disposition === 'suppress') {
    return disposition;
  }
  issues.push(issue);
  nodes.push({ ...node, status: disposition });
  return disposition;
}

/**
 * Grades `issue` under `controlPolicy` and, unless suppressed, pushes the issue
 * (no verification node). Returns the resolved outcome so the caller maps it to
 * a node status itself without re-grading.
 */
export function emitIssueUnderControlPolicy(
  controlPolicy: ControlPolicy,
  issue: SchemaIssue,
  issues: SchemaIssue[],
): VerifierOutcome {
  const disposition = verifierDisposition(controlPolicy, issue.kind);
  if (disposition === 'suppress') {
    return disposition;
  }
  issues.push(issue);
  return disposition;
}
