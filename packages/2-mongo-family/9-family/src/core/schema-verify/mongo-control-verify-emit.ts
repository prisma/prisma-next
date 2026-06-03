import type { ControlPolicy } from '@prisma-next/contract/types';
import type {
  SchemaIssue,
  SchemaVerificationNode,
  VerifierOutcome,
} from '@prisma-next/framework-components/control';
import { verifierDisposition } from './verifier-disposition';

/**
 * Reconciles a control-policy disposition with the Mongo family's strict-mode
 * contract for live-only extras — the single point where `strict` and the
 * control policy meet.
 *
 * The control policy decides first; only a `fail` is reconciled against the
 * caller's base node status. Call sites stamp a live-only extra with
 * `strict ? 'fail' : 'warn'` and a declared missing/mismatch with `fail`, so
 * this one step encodes the whole matrix:
 *
 * | live-vs-declared                    | strict   | non-strict |
 * |-------------------------------------|----------|------------|
 * | declared missing / mismatch         | fail     | fail       |
 * | live-only extra (managed/tolerated) | fail     | warn       |
 * | live-only extra (external)          | suppress (extras ignored, both modes) |
 * | anything (observed)                 | warn (both modes)     |
 *
 * `tolerated` no longer diverges from `managed` on a non-strict extra index:
 * both soften to `warn`, because the softening comes from the base status the
 * caller already computed from `strict`, not from per-policy special-casing.
 */
function reconcileMongoOutcome(
  controlPolicy: ControlPolicy,
  issueKind: SchemaIssue['kind'],
  baseStatus: SchemaVerificationNode['status'],
): VerifierOutcome {
  const disposition = verifierDisposition(controlPolicy, issueKind);
  return disposition === 'fail' ? baseStatus : disposition;
}

export function emitMongoIssueAndNodeUnderControlPolicy(
  controlPolicy: ControlPolicy,
  issue: SchemaIssue,
  node: SchemaVerificationNode,
  issues: SchemaIssue[],
  nodes: SchemaVerificationNode[],
): VerifierOutcome {
  const outcome = reconcileMongoOutcome(controlPolicy, issue.kind, node.status);
  if (outcome === 'suppress') {
    return 'suppress';
  }
  issues.push(issue);
  nodes.push({ ...node, status: outcome });
  return outcome;
}
