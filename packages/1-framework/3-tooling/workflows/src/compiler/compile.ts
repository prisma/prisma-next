import type {
  ParsePslDocumentResult,
  PslDiagnostic,
  PslWorkflow,
  PslWorkflowExecutableNode,
  PslWorkflowState,
} from '@prisma-next/psl-parser';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { blindCast } from '@prisma-next/utils/casts';
import { contentHash, contentHashVersion } from '../shared/hash';
import { slugifyWorkflowName } from '../shared/path';
import type {
  WorkflowApprovalIR,
  WorkflowBudgetPolicy,
  WorkflowCanvasIR,
  WorkflowConnectorBindingIR,
  WorkflowDefinitionIR,
  WorkflowExecutionNodeIR,
  WorkflowManifest,
  WorkflowParallelIR,
  WorkflowPoliciesIR,
  WorkflowRetryPolicy,
  WorkflowSideEffectMode,
  WorkflowStateIR,
  WorkflowStepIR,
  WorkflowTimerIR,
  WorkflowTriggerIR,
} from '../shared/types';
import { booleanProperty, propertyMap, stringListProperty, stringProperty } from './value';

export interface CompileWorkflowSchemaInput {
  readonly schema: string;
  readonly sourceId: string;
}

export interface CompileWorkflowSchemaResult {
  readonly ok: boolean;
  readonly ast: ParsePslDocumentResult['ast'];
  readonly diagnostics: ParsePslDocumentResult['diagnostics'];
  readonly manifest: WorkflowManifest;
}

export function compileWorkflowSchema(
  input: CompileWorkflowSchemaInput,
): CompileWorkflowSchemaResult {
  const parsed = parsePslDocument({ schema: input.schema, sourceId: input.sourceId });
  const semanticDiagnostics = validateWorkflowSemantics(parsed.ast.workflows ?? [], input.sourceId);
  const diagnostics = [...parsed.diagnostics, ...semanticDiagnostics];
  const workflows = (parsed.ast.workflows ?? []).map((workflow) =>
    compileWorkflow(workflow, input.sourceId),
  );
  const manifestBody = {
    sourceId: input.sourceId,
    schema: input.schema,
    workflows,
  };
  const manifest: WorkflowManifest = {
    kind: 'prisma-workflow-manifest',
    version: 1,
    sourceId: input.sourceId,
    sourceHash: contentHash(manifestBody),
    schema: input.schema,
    workflows,
  };
  return {
    ok: diagnostics.length === 0,
    ast: parsed.ast,
    diagnostics,
    manifest,
  };
}

export function compileWorkflow(workflow: PslWorkflow, sourceId: string): WorkflowDefinitionIR {
  const slug = slugifyWorkflowName(workflow.name);
  const triggers = workflow.triggers.map((trigger) => compileTrigger(trigger));
  const states = workflow.states.map(compileState);
  const nodes = compileExecutionNodes(workflow);
  const policies = compilePolicies(nodes);
  const connectors = compileConnectorBindings(triggers, nodes);
  const body = { sourceId, workflow, triggers, states, nodes };
  const sourceHash = contentHash(body);
  const definition: WorkflowDefinitionIR = {
    id: slug,
    name: workflow.name,
    slug,
    version: contentHashVersion(sourceHash),
    sourceHash,
    triggers,
    states,
    nodes,
    policies,
    connectors,
    canvas: buildCanvas(workflow.name, triggers, states, nodes),
  };
  return definition;
}

function compileTrigger(node: PslWorkflowExecutableNode): WorkflowTriggerIR {
  const props = propertyMap(node.properties);
  const dedupeBy = stringProperty(props, 'dedupeBy');
  const connector = stringProperty(props, 'connector');
  return {
    id: `trigger:${node.name}`,
    kind: 'trigger',
    name: node.name,
    source: stringProperty(props, 'source') ?? connector ?? 'manual',
    ...(connector !== undefined ? { connector } : {}),
    event: stringProperty(props, 'event') ?? node.name,
    ...(dedupeBy !== undefined ? { dedupeBy } : {}),
  };
}

function compileState(state: PslWorkflowState): WorkflowStateIR {
  return {
    name: state.name,
    fields: state.fields.map((field) => ({
      name: field.name,
      type: field.typeName,
      optional: field.optional,
      list: field.list,
      id: field.attributes.some((attr) => attr.name === 'id'),
    })),
  };
}

function compileExecutionNodes(workflow: PslWorkflow): WorkflowExecutionNodeIR[] {
  const executionNodes =
    workflow.members.length > 0
      ? workflow.members.filter(isWorkflowExecutionMember)
      : [
          ...workflow.steps,
          ...workflow.approvals,
          ...workflow.conditions,
          ...workflow.timers,
          ...workflow.parallels,
        ].sort((a, b) => a.span.start.offset - b.span.start.offset);
  return executionNodes.map((node) => {
    const props = propertyMap(node.properties);
    switch (node.kind) {
      case 'step':
        return compileStep(node, props);
      case 'approval':
        return optionalWorkflowNode({
          id: `approval:${node.name}`,
          kind: 'approval' as const,
          name: node.name,
          when: stringProperty(props, 'when'),
          timeout: stringProperty(props, 'timeout'),
          assignees: stringListProperty(props, 'assignees'),
          onApprove: stringProperty(props, 'onApprove'),
          onReject: stringProperty(props, 'onReject'),
          onTimeout: stringProperty(props, 'onTimeout'),
        }) satisfies WorkflowApprovalIR;
      case 'condition':
        return {
          id: `condition:${node.name}`,
          kind: 'condition',
          name: node.name,
          when: stringProperty(props, 'when') ?? 'true',
        };
      case 'timer':
        return optionalWorkflowNode({
          id: `timer:${node.name}`,
          kind: 'timer' as const,
          name: node.name,
          resumeAt: stringProperty(props, 'resumeAt'),
          delay: stringProperty(props, 'delay'),
        }) satisfies WorkflowTimerIR;
      case 'parallel': {
        const rawBranches = props['branches'];
        const branches = Array.isArray(rawBranches)
          ? rawBranches.filter((item): item is string => typeof item === 'string')
          : [];
        return {
          id: `parallel:${node.name}`,
          kind: 'parallel',
          name: node.name,
          branches,
        } satisfies WorkflowParallelIR;
      }
      default:
        throw new Error('Unsupported workflow node kind');
    }
  });
}

function isWorkflowExecutionMember(
  member: PslWorkflow['members'][number],
): member is PslWorkflowExecutableNode {
  return member.kind !== 'state' && member.kind !== 'trigger';
}

function validateWorkflowSemantics(
  workflows: readonly PslWorkflow[],
  sourceId: string,
): readonly PslDiagnostic[] {
  const diagnostics: PslDiagnostic[] = [];
  for (const workflow of workflows) {
    validateDuplicateWorkflowMembers(workflow, sourceId, diagnostics);
    validateWorkflowProperties(workflow, sourceId, diagnostics);
    validateWorkflowReferences(workflow, sourceId, diagnostics);
  }
  return diagnostics;
}

function validateDuplicateWorkflowMembers(
  workflow: PslWorkflow,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  const seen = new Map<string, PslWorkflow['members'][number]>();
  for (const member of workflow.members) {
    const previous = seen.get(member.name);
    if (previous) {
      diagnostics.push({
        code: 'PSL_INVALID_WORKFLOW_MEMBER',
        message: `Workflow "${workflow.name}" declares member "${member.name}" more than once; workflow member names must be unique for routing, approvals, and Studio links`,
        sourceId,
        span: member.span,
      });
      diagnostics.push({
        code: 'PSL_INVALID_WORKFLOW_MEMBER',
        message: `First declaration of workflow member "${member.name}" is here`,
        sourceId,
        span: previous.span,
      });
      continue;
    }
    seen.set(member.name, member);
  }
}

function validateWorkflowProperties(
  workflow: PslWorkflow,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  for (const node of workflow.members) {
    if (node.kind === 'state') continue;
    const props = propertyMap(node.properties);
    validateDuplicateProperties(node, sourceId, diagnostics);
    validateKnownProperties(node, sourceId, diagnostics);
    switch (node.kind) {
      case 'trigger':
        requireStringProperty(node, props, 'source', sourceId, diagnostics);
        requireStringProperty(node, props, 'event', sourceId, diagnostics);
        optionalStringProperty(node, props, 'dedupeBy', sourceId, diagnostics);
        optionalStringProperty(node, props, 'connector', sourceId, diagnostics);
        break;
      case 'step':
        requireStringProperty(node, props, 'run', sourceId, diagnostics);
        optionalDurationProperty(node, props, 'timeout', sourceId, diagnostics);
        validateStepSideEffects(node, props, sourceId, diagnostics);
        validateRetry(node, props, sourceId, diagnostics);
        validateBudget(node, props, sourceId, diagnostics);
        optionalStringProperty(node, props, 'idempotency', sourceId, diagnostics);
        break;
      case 'approval':
        optionalStringProperty(node, props, 'when', sourceId, diagnostics);
        optionalDurationProperty(node, props, 'timeout', sourceId, diagnostics);
        validateStringList(node, props, 'assignees', sourceId, diagnostics);
        optionalStringProperty(node, props, 'onApprove', sourceId, diagnostics);
        optionalStringProperty(node, props, 'onReject', sourceId, diagnostics);
        optionalStringProperty(node, props, 'onTimeout', sourceId, diagnostics);
        break;
      case 'condition':
        requireStringProperty(node, props, 'when', sourceId, diagnostics);
        break;
      case 'timer':
        optionalDurationProperty(node, props, 'delay', sourceId, diagnostics);
        optionalStringProperty(node, props, 'resumeAt', sourceId, diagnostics);
        if (props['delay'] === undefined && props['resumeAt'] === undefined) {
          diagnostics.push({
            code: 'PSL_INVALID_WORKFLOW_MEMBER',
            message: `Timer "${node.name}" must declare either \`delay\` or \`resumeAt\``,
            sourceId,
            span: node.span,
          });
        }
        break;
      case 'parallel':
        diagnostics.push({
          code: 'PSL_INVALID_WORKFLOW_MEMBER',
          message: `parallel "${node.name}" is parsed for forward compatibility but is not executable in this Prisma Workflows MVP; model each branch as explicit steps for now`,
          sourceId,
          span: node.span,
        });
        validateStringList(node, props, 'branches', sourceId, diagnostics);
        break;
    }
  }
}

function validateWorkflowReferences(
  workflow: PslWorkflow,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  const nodeNames = new Set(
    workflow.members.filter(isWorkflowExecutionMember).map((node) => node.name),
  );
  for (const node of workflow.members) {
    if (node.kind === 'state' || node.kind === 'trigger') continue;
    const props = propertyMap(node.properties);
    if (node.kind === 'approval') {
      for (const key of ['onApprove', 'onReject', 'onTimeout']) {
        const target = props[key];
        if (typeof target !== 'string' || nodeNames.has(target)) continue;
        diagnostics.push({
          code: 'PSL_INVALID_WORKFLOW_MEMBER',
          message: `Approval "${node.name}" references unknown workflow node "${target}" in \`${key}\``,
          sourceId,
          span: propertySpan(node, key) ?? node.span,
        });
      }
    }
    if (node.kind === 'parallel') {
      const branches = props['branches'];
      if (!Array.isArray(branches)) continue;
      for (const branch of branches) {
        if (typeof branch !== 'string' || nodeNames.has(branch)) continue;
        diagnostics.push({
          code: 'PSL_INVALID_WORKFLOW_MEMBER',
          message: `Parallel "${node.name}" references unknown branch node "${branch}"`,
          sourceId,
          span: propertySpan(node, 'branches') ?? node.span,
        });
      }
    }
  }
}

const allowedWorkflowProperties = {
  trigger: new Set(['source', 'connector', 'event', 'dedupeBy']),
  step: new Set(['run', 'timeout', 'checkpoint', 'sideEffects', 'retry', 'budget', 'idempotency']),
  approval: new Set(['when', 'timeout', 'assignees', 'onApprove', 'onReject', 'onTimeout']),
  condition: new Set(['when']),
  timer: new Set(['resumeAt', 'delay']),
  parallel: new Set(['branches']),
};

function validateKnownProperties(
  node: PslWorkflowExecutableNode,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  const allowed = allowedWorkflowProperties[node.kind];
  for (const property of node.properties) {
    if (allowed.has(property.name)) continue;
    diagnostics.push({
      code: 'PSL_INVALID_WORKFLOW_MEMBER',
      message: `${node.kind} "${node.name}" does not support property \`${property.name}\``,
      sourceId,
      span: property.span,
    });
  }
}

function validateDuplicateProperties(
  node: PslWorkflowExecutableNode,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const property of node.properties) {
    if (!seen.has(property.name)) {
      seen.add(property.name);
      continue;
    }
    diagnostics.push({
      code: 'PSL_INVALID_WORKFLOW_MEMBER',
      message: `${node.kind} "${node.name}" declares property \`${property.name}\` more than once`,
      sourceId,
      span: property.span,
    });
  }
}

function requireStringProperty(
  node: PslWorkflowExecutableNode,
  props: Record<string, unknown>,
  key: string,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  if (typeof props[key] === 'string') return;
  diagnostics.push({
    code: 'PSL_INVALID_WORKFLOW_MEMBER',
    message: `${node.kind} "${node.name}" must declare string property \`${key}\``,
    sourceId,
    span: propertySpan(node, key) ?? node.span,
  });
}

function optionalStringProperty(
  node: PslWorkflowExecutableNode,
  props: Record<string, unknown>,
  key: string,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  if (props[key] === undefined || typeof props[key] === 'string') return;
  diagnostics.push({
    code: 'PSL_INVALID_WORKFLOW_MEMBER',
    message: `${node.kind} "${node.name}" property \`${key}\` must be a string`,
    sourceId,
    span: propertySpan(node, key) ?? node.span,
  });
}

function optionalDurationProperty(
  node: PslWorkflowExecutableNode,
  props: Record<string, unknown>,
  key: string,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  const value = props[key];
  if (value === undefined) return;
  if (typeof value === 'string' && isDurationLiteral(value)) return;
  diagnostics.push({
    code: 'PSL_INVALID_WORKFLOW_MEMBER',
    message: `${node.kind} "${node.name}" property \`${key}\` must be a duration like "500ms", "30s", "5m", "2h", or "1d"`,
    sourceId,
    span: propertySpan(node, key) ?? node.span,
  });
}

function validateStringList(
  node: PslWorkflowExecutableNode,
  props: Record<string, unknown>,
  key: string,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  const value = props[key];
  if (value === undefined) return;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return;
  diagnostics.push({
    code: 'PSL_INVALID_WORKFLOW_MEMBER',
    message: `${node.kind} "${node.name}" property \`${key}\` must be a list of strings`,
    sourceId,
    span: propertySpan(node, key) ?? node.span,
  });
}

function validateStepSideEffects(
  node: PslWorkflowExecutableNode,
  props: Record<string, unknown>,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  const value = props['sideEffects'];
  if (value !== undefined && value !== 'none' && value !== 'internal' && value !== 'external') {
    diagnostics.push({
      code: 'PSL_INVALID_WORKFLOW_MEMBER',
      message: `step "${node.name}" property \`sideEffects\` must be "none", "internal", or "external"`,
      sourceId,
      span: propertySpan(node, 'sideEffects') ?? node.span,
    });
  }
  if (value === 'external' && typeof props['idempotency'] !== 'string') {
    diagnostics.push({
      code: 'PSL_INVALID_WORKFLOW_MEMBER',
      message: `step "${node.name}" has external side effects and must declare an \`idempotency\` expression`,
      sourceId,
      span: propertySpan(node, 'sideEffects') ?? node.span,
    });
  }
}

function validateRetry(
  node: PslWorkflowExecutableNode,
  props: Record<string, unknown>,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  const retry = props['retry'];
  if (retry === undefined) return;
  if (!retry || typeof retry !== 'object' || Array.isArray(retry)) {
    diagnostics.push({
      code: 'PSL_INVALID_WORKFLOW_MEMBER',
      message: `step "${node.name}" property \`retry\` must be an object with maxAttempts and optional backoff`,
      sourceId,
      span: propertySpan(node, 'retry') ?? node.span,
    });
    return;
  }
  const value = recordFromObject(retry);
  if (typeof value['maxAttempts'] !== 'number' || value['maxAttempts'] < 1) {
    diagnostics.push({
      code: 'PSL_INVALID_WORKFLOW_MEMBER',
      message: `step "${node.name}" retry.maxAttempts must be a positive number`,
      sourceId,
      span: propertySpan(node, 'retry') ?? node.span,
    });
  }
  if (
    value['backoff'] !== undefined &&
    value['backoff'] !== 'fixed' &&
    value['backoff'] !== 'exponential'
  ) {
    diagnostics.push({
      code: 'PSL_INVALID_WORKFLOW_MEMBER',
      message: `step "${node.name}" retry.backoff must be "fixed" or "exponential"`,
      sourceId,
      span: propertySpan(node, 'retry') ?? node.span,
    });
  }
}

function validateBudget(
  node: PslWorkflowExecutableNode,
  props: Record<string, unknown>,
  sourceId: string,
  diagnostics: PslDiagnostic[],
): void {
  const budget = props['budget'];
  if (budget === undefined) return;
  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) {
    diagnostics.push({
      code: 'PSL_INVALID_WORKFLOW_MEMBER',
      message: `step "${node.name}" property \`budget\` must be an object`,
      sourceId,
      span: propertySpan(node, 'budget') ?? node.span,
    });
    return;
  }
  const value = recordFromObject(budget);
  for (const key of ['maxUsd', 'maxTokens']) {
    if (value[key] === undefined || (typeof value[key] === 'number' && value[key] >= 0)) continue;
    diagnostics.push({
      code: 'PSL_INVALID_WORKFLOW_MEMBER',
      message: `step "${node.name}" budget.${key} must be a non-negative number`,
      sourceId,
      span: propertySpan(node, 'budget') ?? node.span,
    });
  }
  if (value['timeout'] !== undefined) {
    if (typeof value['timeout'] === 'string' && isDurationLiteral(value['timeout'])) return;
    diagnostics.push({
      code: 'PSL_INVALID_WORKFLOW_MEMBER',
      message: `step "${node.name}" budget.timeout must be a duration string`,
      sourceId,
      span: propertySpan(node, 'budget') ?? node.span,
    });
  }
}

function propertySpan(node: PslWorkflowExecutableNode, key: string) {
  return node.properties.find((property) => property.name === key)?.span;
}

function isDurationLiteral(value: string): boolean {
  return /^\d+(?:\.\d+)?(?:ms|s|m|h|d)$/.test(value.trim());
}

function compileStep(
  node: PslWorkflowExecutableNode,
  props: Record<string, unknown>,
): WorkflowStepIR {
  return optionalWorkflowNode({
    id: `step:${node.name}`,
    kind: 'step' as const,
    name: node.name,
    run: stringProperty(props, 'run') ?? `./workflows/${node.name}.ts`,
    timeout: stringProperty(props, 'timeout'),
    checkpoint: booleanProperty(props, 'checkpoint'),
    sideEffects: compileSideEffectMode(props['sideEffects']),
    retry: compileRetry(props['retry']),
    budget: compileBudget(props['budget']),
    idempotency: stringProperty(props, 'idempotency'),
  }) satisfies WorkflowStepIR;
}

function compileRetry(raw: unknown): WorkflowRetryPolicy | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = recordFromObject(raw);
  const maxAttempts = value['maxAttempts'];
  const backoff = value['backoff'];
  if (typeof maxAttempts !== 'number') return undefined;
  return {
    maxAttempts,
    backoff: backoff === 'fixed' ? 'fixed' : 'exponential',
  };
}

function compileBudget(raw: unknown): WorkflowBudgetPolicy | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = recordFromObject(raw);
  const budget: WorkflowBudgetPolicy = {
    ...(typeof value['maxUsd'] === 'number' ? { maxUsd: value['maxUsd'] } : {}),
    ...(typeof value['maxTokens'] === 'number' ? { maxTokens: value['maxTokens'] } : {}),
    ...(typeof value['timeout'] === 'string' ? { timeout: value['timeout'] } : {}),
  };
  return Object.keys(budget).length > 0 ? budget : undefined;
}

function compileSideEffectMode(raw: unknown): WorkflowSideEffectMode {
  return raw === 'none' || raw === 'external' || raw === 'internal' ? raw : 'internal';
}

function compilePolicies(nodes: readonly WorkflowExecutionNodeIR[]): WorkflowPoliciesIR {
  const retryAttempts = nodes
    .filter((node): node is WorkflowStepIR => node.kind === 'step')
    .flatMap((node) => (node.retry ? [node.retry.maxAttempts] : []));
  const maxRetries = retryAttempts.length > 0 ? Math.max(...retryAttempts) : undefined;
  return optionalWorkflowNode({
    maxRetries,
  }) satisfies WorkflowPoliciesIR;
}

function compileConnectorBindings(
  triggers: readonly WorkflowTriggerIR[],
  nodes: readonly WorkflowExecutionNodeIR[],
): readonly WorkflowConnectorBindingIR[] {
  const byConnector = new Map<
    string,
    { events: Set<string>; actions: Set<string>; syncs: Set<string> }
  >();
  for (const trigger of triggers) {
    const connector = trigger.connector ?? trigger.source;
    const entry = byConnector.get(connector) ?? {
      events: new Set<string>(),
      actions: new Set<string>(),
      syncs: new Set<string>(),
    };
    entry.events.add(trigger.event);
    byConnector.set(connector, entry);
  }
  for (const node of nodes) {
    if (node.kind !== 'step') continue;
    const connector = connectorFromRunPath(node.run);
    if (!connector) continue;
    const entry = byConnector.get(connector) ?? {
      events: new Set<string>(),
      actions: new Set<string>(),
      syncs: new Set<string>(),
    };
    entry.actions.add(node.name);
    byConnector.set(connector, entry);
  }
  return [...byConnector.entries()].map(([connector, capabilities]) => ({
    id: connector,
    connector,
    events: [...capabilities.events],
    actions: [...capabilities.actions],
    syncs: [...capabilities.syncs],
  }));
}

function connectorFromRunPath(path: string): string | undefined {
  const match = path.match(/(?:^|[/\\])(?:connector|connectors)-([A-Za-z0-9_-]+)(?:[/\\]|$)/);
  return match?.[1];
}

type WithoutUndefinedValues<T extends Record<string, unknown>> = {
  readonly [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  readonly [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

function optionalWorkflowNode<T extends Record<string, unknown>>(
  value: T,
): WithoutUndefinedValues<T> {
  return blindCast<
    WithoutUndefinedValues<T>,
    'filtered Object.fromEntries preserves keys while removing undefined values'
  >(Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)));
}

function recordFromObject(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

function buildCanvas(
  workflowName: string,
  triggers: readonly WorkflowTriggerIR[],
  states: readonly WorkflowStateIR[],
  executionNodes: readonly WorkflowExecutionNodeIR[],
): WorkflowCanvasIR {
  const nodes = [
    ...triggers.map((trigger, index) => ({
      id: trigger.id,
      kind: trigger.kind,
      label: trigger.name,
      x: 80,
      y: 80 + index * 120,
      sourceRef: trigger.source,
      config: optionalWorkflowNode({
        event: trigger.event,
        dedupeBy: trigger.dedupeBy,
      }),
    })),
    ...states.map((state, index) => ({
      id: `state:${state.name}`,
      kind: 'state' as const,
      label: state.name,
      x: 80,
      y: 260 + index * 120,
    })),
    ...executionNodes.map((node, index) => ({
      id: node.id,
      kind: node.kind,
      label: node.name,
      x: 320 + index * 220,
      y: 140,
      ...(node.kind === 'step' ? { codeRef: node.run } : {}),
      config: nodeConfig(node),
    })),
  ];
  const chain = [...triggers.map((t) => t.id), ...executionNodes.map((n) => n.id)];
  const edges = chain.slice(0, -1).flatMap((from, index) => {
    const to = chain[index + 1];
    return to === undefined
      ? []
      : [
          {
            id: `${workflowName}:edge:${index}`,
            from,
            to,
          },
        ];
  });
  return { nodes, edges: [...edges, ...approvalOutcomeEdges(workflowName, executionNodes)] };
}

function approvalOutcomeEdges(
  workflowName: string,
  executionNodes: readonly WorkflowExecutionNodeIR[],
): readonly {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label: string;
}[] {
  const byNameOrId = new Map<string, WorkflowExecutionNodeIR>();
  for (const node of executionNodes) {
    byNameOrId.set(node.name, node);
    byNameOrId.set(node.id, node);
  }
  const edges: {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly label: string;
  }[] = [];
  for (const node of executionNodes) {
    if (node.kind !== 'approval') continue;
    const outcomes: ReadonlyArray<readonly ['approve' | 'reject' | 'timeout', string | undefined]> =
      [
        ['approve', node.onApprove],
        ['reject', node.onReject],
        ['timeout', node.onTimeout],
      ];
    for (const [label, target] of outcomes) {
      const to = target ? byNameOrId.get(target)?.id : undefined;
      if (!to) continue;
      edges.push({
        id: `${workflowName}:approval:${node.name}:${label}`,
        from: node.id,
        to,
        label,
      });
    }
  }
  return edges;
}

function nodeConfig(node: WorkflowExecutionNodeIR): Record<string, unknown> {
  switch (node.kind) {
    case 'step':
      return optionalWorkflowNode({
        timeout: node.timeout,
        checkpoint: node.checkpoint,
        sideEffects: node.sideEffects,
        retry: node.retry,
        budget: node.budget,
        idempotency: node.idempotency,
      });
    case 'approval':
      return optionalWorkflowNode({
        when: node.when,
        timeout: node.timeout,
        assignees: node.assignees,
        onApprove: node.onApprove,
        onReject: node.onReject,
        onTimeout: node.onTimeout,
      });
    case 'condition':
      return { when: node.when };
    case 'timer':
      return optionalWorkflowNode({ resumeAt: node.resumeAt, delay: node.delay });
    case 'parallel':
      return { branches: node.branches };
  }
}
