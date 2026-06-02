import type { ControlPolicy } from '@prisma-next/contract/types';
import { verifierDisposition } from '@prisma-next/contract/types';
import type {
  SchemaIssue,
  SchemaVerificationNode,
} from '@prisma-next/framework-components/control';

export function pushControlledFinding(
  control: ControlPolicy,
  issue: SchemaIssue,
  node: SchemaVerificationNode,
  issues: SchemaIssue[],
  nodes: SchemaVerificationNode[],
): void {
  const disposition = verifierDisposition(control, issue.kind);
  if (disposition === 'suppress') {
    return;
  }
  issues.push(issue);
  nodes.push({ ...node, status: disposition });
}

export function pushControlledIssueOnly(
  control: ControlPolicy,
  issue: SchemaIssue,
  issues: SchemaIssue[],
): boolean {
  const disposition = verifierDisposition(control, issue.kind);
  if (disposition === 'suppress') {
    return false;
  }
  issues.push(issue);
  return disposition === 'warn';
}
