import type { WorkflowDefinitionIR } from './types';

export function slugifyWorkflowName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function workflowVersionId(workflow: WorkflowDefinitionIR): string {
  const hashParts = workflow.sourceHash.split(':');
  const hash = hashParts[hashParts.length - 1] ?? workflow.sourceHash;
  return `${workflow.id}:v:${hash.slice(0, 16)}`;
}

export function getPath(input: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  const segments = path.split('.').filter(Boolean);
  let cursor: unknown = input;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    const entry = Object.entries(cursor).find(([key]) => key === segment);
    cursor = entry?.[1];
  }
  return cursor;
}

export function deepClone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
