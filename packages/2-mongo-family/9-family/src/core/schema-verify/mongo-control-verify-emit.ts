import type { ControlPolicy } from '@prisma-next/contract/types';
import { verifierDisposition } from '@prisma-next/contract/types';
import type {
  SchemaIssue,
  SchemaVerificationNode,
} from '@prisma-next/framework-components/control';

function mongoVerifierDisposition(
  control: ControlPolicy,
  issueKind: string,
  strict: boolean,
): ReturnType<typeof verifierDisposition> {
  if (!strict && control === 'managed') {
    if (
      issueKind === 'extra_table' ||
      issueKind === 'extra_index' ||
      issueKind === 'extra_validator'
    ) {
      return 'warn';
    }
  }
  return verifierDisposition(control, issueKind);
}

export function pushMongoControlledFinding(
  control: ControlPolicy,
  issue: SchemaIssue,
  node: SchemaVerificationNode,
  issues: SchemaIssue[],
  nodes: SchemaVerificationNode[],
  strict: boolean,
  options?: { readonly legacyNonStrictWarn?: boolean },
): SchemaVerificationNode['status'] | 'suppress' {
  const disposition =
    !strict && options?.legacyNonStrictWarn && control === 'managed'
      ? 'warn'
      : mongoVerifierDisposition(control, issue.kind, strict);
  if (disposition === 'suppress') {
    return 'suppress';
  }
  issues.push(issue);
  nodes.push({ ...node, status: disposition });
  return disposition;
}
