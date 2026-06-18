import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { stableStringify } from '../shared/hash';
import { renderWorkflowSqlDdl } from '../shared/sql-ddl';
import type { WorkflowDefinitionIR, WorkflowManifest, WorkflowStateFieldIR } from '../shared/types';

export interface GenerateWorkflowArtifactsInput {
  readonly manifest: WorkflowManifest;
  readonly outputDir: string;
  readonly schemaPath?: string;
  readonly schemaName?: string;
}

export interface GeneratedWorkflowArtifacts {
  readonly manifestJson: string;
  readonly indexTs: string;
  readonly typesDts: string;
  readonly schemaSql: string;
  readonly studioJson: string;
  readonly computeTs: string;
}

export async function generateWorkflowArtifacts(
  input: GenerateWorkflowArtifactsInput,
): Promise<GeneratedWorkflowArtifacts> {
  const files = renderWorkflowArtifacts(
    input.manifest,
    optionalRenderOptions({
      outputDir: input.outputDir,
      ...(input.schemaPath !== undefined ? { schemaPath: input.schemaPath } : {}),
      ...(input.schemaName !== undefined ? { schemaName: input.schemaName } : {}),
    }),
  );
  await writeGeneratedFile(join(input.outputDir, 'manifest.json'), files.manifestJson);
  await writeGeneratedFile(join(input.outputDir, 'index.ts'), files.indexTs);
  await writeGeneratedFile(join(input.outputDir, 'index.d.ts'), files.typesDts);
  await writeGeneratedFile(join(input.outputDir, 'schema.sql'), files.schemaSql);
  await writeGeneratedFile(join(input.outputDir, 'studio.json'), files.studioJson);
  await writeGeneratedFile(join(input.outputDir, 'compute.ts'), files.computeTs);
  return files;
}

export function renderWorkflowArtifacts(
  manifest: WorkflowManifest,
  options: RenderWorkflowArtifactsOptions = {},
): GeneratedWorkflowArtifacts {
  const names = manifest.workflows.map((workflow) => workflow.name);
  const nameUnion =
    names.length > 0 ? names.map((name) => JSON.stringify(name)).join(' | ') : 'never';
  const workflowTypeBlocks = manifest.workflows.map(renderWorkflowTypeBlock).join('\n\n');
  const workflowAccessors = renderWorkflowAccessors(manifest.workflows);
  const workflowInputMap = renderWorkflowInputMap(manifest.workflows);
  const workflowAccessorType = renderWorkflowAccessorType(manifest.workflows);
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestLiteral = stableStringify(manifest, 2);
  const schemaSql = renderWorkflowSqlDdl(options.schemaName);
  const studioJson = `${JSON.stringify(
    {
      kind: 'prisma-workflow-studio-model',
      version: 1,
      runtime: {
        datasets: [
          'ingestEvents',
          'runs',
          'steps',
          'timeline',
          'stateSnapshots',
          'approvals',
          'outbox',
          'deadLetters',
        ],
        endpoints: {
          snapshot: '/api/prisma-workflows/studio',
          inspectRun: '/api/prisma-workflows/inspect/:runId',
          approve: '/api/prisma-workflows/approve/:approvalId',
          reject: '/api/prisma-workflows/reject/:approvalId',
          replay: '/api/prisma-workflows/replay/:runId',
          worker: '/api/prisma-workflows/run',
        },
      },
      workflows: manifest.workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        slug: workflow.slug,
        version: workflow.version,
        canvas: workflow.canvas,
      })),
    },
    null,
    2,
  )}\n`;

  return {
    manifestJson,
    schemaSql,
    studioJson,
    indexTs: `import {
  createWorkflowClient,
  createWorkflowRuntime,
} from '@prisma-next/workflows/runtime';
import type { WorkflowManifest } from '@prisma-next/workflows';
import type { WorkflowReplayOptions, WorkflowRunInclude } from '@prisma-next/workflows/runtime';

export const manifest = ${manifestLiteral} as const satisfies WorkflowManifest;

export type WorkflowName = ${nameUnion};

${workflowTypeBlocks}

export function workflowRuntime(options = {}) {
  return createWorkflowRuntime({ manifest, ...options });
}

export function workflowClient(options = {}) {
  const client = createWorkflowClient(workflowRuntime(options));
  return Object.assign(client, {
    workflows: ${workflowAccessors},
  });
}

export function workflows(options = {}) {
  const client = workflowClient(options);
  return {
    name: 'prisma-workflows',
    client: {
      workflow: client,
    },
  };
}
`,
    typesDts: `import type {
  WorkflowClient,
  WorkflowReplayOptions,
  WorkflowRunInclude,
  WorkflowRunWithInclude,
  WorkflowRuntime,
} from '@prisma-next/workflows/runtime';
import type { WorkflowRunRecord } from '@prisma-next/workflows';
import type { WorkflowManifest } from '@prisma-next/workflows';
export declare const manifest: WorkflowManifest;
export type WorkflowName = ${nameUnion};
${workflowTypeBlocks}
export interface WorkflowInputByName ${workflowInputMap}
export interface WorkflowAccessors ${workflowAccessorType}
export type TypedWorkflowClient = Omit<WorkflowClient, 'enqueue'> & {
  enqueue<N extends WorkflowName>(workflowName: N, input: WorkflowInputByName[N]): Promise<WorkflowRunRecord>;
  readonly workflows: WorkflowAccessors;
};
export declare function workflowRuntime(options?: Record<string, unknown>): WorkflowRuntime;
export declare function workflowClient(options?: Record<string, unknown>): TypedWorkflowClient;
export declare function workflows(options?: Record<string, unknown>): {
  readonly name: 'prisma-workflows';
  readonly client: {
    readonly workflow: TypedWorkflowClient;
  };
};
`,
    computeTs: renderComputeEntrypoint(manifest, options),
  };
}

interface RenderWorkflowArtifactsOptions {
  readonly schemaName?: string;
  readonly outputDir?: string;
  readonly schemaPath?: string;
}

interface ComputeModuleImport {
  readonly variable: string;
  readonly specifier: string;
}

interface ComputeStepBinding {
  readonly name: string;
  readonly run: string;
  readonly moduleVariable: string;
}

interface ComputeConnectorBinding {
  readonly connector: string;
  readonly moduleVariable: string;
}

function optionalRenderOptions(
  options: RenderWorkflowArtifactsOptions,
): RenderWorkflowArtifactsOptions {
  return options;
}

function renderComputeEntrypoint(
  manifest: WorkflowManifest,
  options: RenderWorkflowArtifactsOptions,
): string {
  const plan = computeStepImportPlan(manifest, options);
  const connectorPlan = computeConnectorImportPlan(manifest, options);
  const imports = [...plan.modules, ...connectorPlan.modules]
    .map(
      (moduleImport) =>
        `import * as ${moduleImport.variable} from ${JSON.stringify(moduleImport.specifier)};`,
    )
    .join('\n');
  const stepEntries = plan.steps.flatMap((step) => [
    `  ${JSON.stringify(step.name)}: pickStep(${step.moduleVariable}, ${JSON.stringify(step.name)}),`,
    `  ${JSON.stringify(step.run)}: pickStep(${step.moduleVariable}, ${JSON.stringify(step.name)}),`,
  ]);
  const stepsLiteral = stepEntries.length === 0 ? '{}' : `{\n${stepEntries.join('\n')}\n}`;
  const connectorEntries = connectorPlan.connectors.map(
    (connector) =>
      `  ${JSON.stringify(connector.connector)}: pickConnector(${connector.moduleVariable}, ${JSON.stringify(connector.connector)}),`,
  );
  const connectorsLiteral =
    connectorEntries.length === 0 ? '{}' : `{\n${connectorEntries.join('\n')}\n}`;
  const importBlock = imports.length > 0 ? `${imports}\n` : '';
  const connectorModuleTypes =
    connectorPlan.connectors.length === 0
      ? ''
      : `
type ConnectorModule = {
  readonly default?: ConnectorDefinition | undefined;
  readonly connector?: ConnectorDefinition | undefined;
  readonly definition?: ConnectorDefinition | undefined;
  readonly [key: string]: unknown;
};
`;
  const connectorHelpers =
    connectorPlan.connectors.length === 0
      ? ''
      : `
function pickConnector(moduleValue: ConnectorModule, connectorId: string): ConnectorDefinition {
  const named = moduleValue[connectorId];
  const connector =
    moduleValue.default ??
    moduleValue.connector ??
    moduleValue.definition ??
    (isConnectorDefinition(named) ? named : undefined);
  if (!connector) {
    throw new Error(\`Workflow connector module for "\${connectorId}" must export default, connector, definition, or a named connector.\`);
  }
  return connector;
}

function isConnectorDefinition(value: unknown): value is ConnectorDefinition {
  return Boolean(value && typeof value === 'object' && 'id' in value);
}
`;
  const storeOptions = [
    'connectionString',
    ...(options.schemaName !== undefined
      ? [`schemaName: ${JSON.stringify(options.schemaName)}`]
      : []),
  ].join(', ');
  return `import {
  createWorkflowHttpApp,
  PostgresWorkflowStore,
  type WorkflowStepHandler,
} from '@prisma-next/workflows/runtime';
import type { ConnectorDefinition } from '@prisma-next/workflows/connector-sdk';
${importBlock}import { manifest } from './index';

type StepModule = {
  readonly default?: WorkflowStepHandler | undefined;
  readonly run?: WorkflowStepHandler | undefined;
  readonly handler?: WorkflowStepHandler | undefined;
  readonly step?: WorkflowStepHandler | undefined;
};
${connectorModuleTypes}

export interface WorkflowComputeAppOptions {
  readonly connectors?: Record<string, ConnectorDefinition>;
  readonly secrets?: Record<string, string | undefined>;
  readonly steps?: Record<string, WorkflowStepHandler>;
  readonly store?: PostgresWorkflowStore;
}

const steps: Record<string, WorkflowStepHandler> = ${stepsLiteral};
const connectors: Record<string, ConnectorDefinition> = ${connectorsLiteral};
const connectionString = process.env['DATABASE_URL'];
const store = connectionString
  ? new PostgresWorkflowStore({ ${storeOptions} })
  : undefined;

export function createApp(options: WorkflowComputeAppOptions = {}) {
  const resolvedStore = options.store ?? store;
  return createWorkflowHttpApp({
    manifest,
    steps: { ...steps, ...(options.steps ?? {}) },
    connectors: { ...connectors, ...(options.connectors ?? {}) },
    ...(options.secrets ? { secrets: options.secrets } : {}),
    ...(resolvedStore ? { store: resolvedStore } : {}),
  });
}

export const app = createApp();
export default app;

function pickStep(moduleValue: StepModule, stepName: string): WorkflowStepHandler {
  const handler = moduleValue.default ?? moduleValue.run ?? moduleValue.handler ?? moduleValue.step;
  if (!handler) {
    throw new Error(\`Workflow step module for "\${stepName}" must export default, run, handler, or step.\`);
  }
  return handler;
}
${connectorHelpers}
`;
}

function computeStepImportPlan(
  manifest: WorkflowManifest,
  options: RenderWorkflowArtifactsOptions,
): {
  readonly modules: readonly ComputeModuleImport[];
  readonly steps: readonly ComputeStepBinding[];
} {
  if (!options.outputDir) {
    return { modules: [], steps: [] };
  }
  const modules: ComputeModuleImport[] = [];
  const steps: ComputeStepBinding[] = [];
  const variablesBySpecifier = new Map<string, string>();
  for (const workflow of manifest.workflows) {
    for (const node of workflow.nodes) {
      if (node.kind !== 'step') continue;
      const specifier = computeStepImportSpecifier(manifest, node.run, options);
      let moduleVariable = variablesBySpecifier.get(specifier);
      if (!moduleVariable) {
        moduleVariable = `stepModule${variablesBySpecifier.size + 1}`;
        variablesBySpecifier.set(specifier, moduleVariable);
        modules.push({ variable: moduleVariable, specifier });
      }
      steps.push({ name: node.name, run: node.run, moduleVariable });
    }
  }
  return { modules, steps };
}

function computeConnectorImportPlan(
  manifest: WorkflowManifest,
  options: RenderWorkflowArtifactsOptions,
): {
  readonly modules: readonly ComputeModuleImport[];
  readonly connectors: readonly ComputeConnectorBinding[];
} {
  if (!options.outputDir) {
    return { modules: [], connectors: [] };
  }
  const modules: ComputeModuleImport[] = [];
  const connectors: ComputeConnectorBinding[] = [];
  const variablesBySpecifier = new Map<string, string>();
  const connectorIds = new Set(
    manifest.workflows.flatMap((workflow) =>
      workflow.connectors.map((connector) => connector.connector),
    ),
  );
  for (const connector of connectorIds) {
    const connectorPath = resolveConnectorPath(manifest, connector, options);
    if (!connectorPath) continue;
    const specifier = computeImportSpecifier(options.outputDir, connectorPath);
    let moduleVariable = variablesBySpecifier.get(specifier);
    if (!moduleVariable) {
      moduleVariable = `connectorModule${variablesBySpecifier.size + 1}`;
      variablesBySpecifier.set(specifier, moduleVariable);
      modules.push({ variable: moduleVariable, specifier });
    }
    connectors.push({ connector, moduleVariable });
  }
  return { modules, connectors };
}

function computeStepImportSpecifier(
  manifest: WorkflowManifest,
  runPath: string,
  options: RenderWorkflowArtifactsOptions,
): string {
  if (runPath.startsWith('@') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(runPath)) {
    return runPath;
  }
  const absoluteStepPath = resolveStepPath(manifest, runPath, options);
  return computeImportSpecifier(options.outputDir ?? '.', absoluteStepPath);
}

function computeImportSpecifier(outputDirPath: string, absolutePath: string): string {
  const outputDir = resolve(outputDirPath);
  let specifier = relative(outputDir, absolutePath).split(sep).join('/');
  if (!specifier.startsWith('.')) {
    specifier = `./${specifier}`;
  }
  return specifier.replace(/\.(cts|mts|tsx|ts)$/, '');
}

function resolveStepPath(
  manifest: WorkflowManifest,
  runPath: string,
  options: RenderWorkflowArtifactsOptions,
): string {
  if (runPath.startsWith('/')) {
    return runPath;
  }
  const candidates = [
    resolve(process.cwd(), runPath),
    ...(options.schemaPath !== undefined ? [resolve(dirname(options.schemaPath), runPath)] : []),
    ...(manifest.sourceId !== undefined
      ? [resolve(dirname(resolve(manifest.sourceId)), runPath)]
      : []),
  ];
  const fallback =
    options.schemaPath !== undefined
      ? resolve(dirname(options.schemaPath), runPath)
      : (candidates[0] ?? resolve(runPath));
  return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
}

function resolveConnectorPath(
  manifest: WorkflowManifest,
  connector: string,
  options: RenderWorkflowArtifactsOptions,
): string | undefined {
  const names = [
    `connectors/${connector}.ts`,
    `connectors/${connector}.mts`,
    `connectors/${connector}/index.ts`,
    `connectors/${connector}/index.mts`,
    `src/connectors/${connector}.ts`,
    `src/connectors/${connector}.mts`,
    `src/connectors/${connector}/index.ts`,
    `src/connectors/${connector}/index.mts`,
  ];
  const roots = [
    process.cwd(),
    ...(options.schemaPath !== undefined ? [dirname(options.schemaPath)] : []),
    ...(manifest.sourceId !== undefined ? [dirname(resolve(manifest.sourceId))] : []),
  ];
  for (const root of roots) {
    for (const name of names) {
      const candidate = resolve(root, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function renderWorkflowAccessors(workflows: readonly WorkflowDefinitionIR[]): string {
  if (workflows.length === 0) {
    return '{}';
  }
  const lines = workflows.map(
    (workflow) => `      ${JSON.stringify(workflow.name)}: {
        enqueue: (input: unknown) => client.enqueue(${JSON.stringify(workflow.name)}, input),
        inspect: (runId: string, input?: { include?: WorkflowRunInclude }) => client.run.findUnique({ where: { id: runId }, ...(input ?? {}) }),
        replay: (runId: string, options?: WorkflowReplayOptions) => client.replay(runId, options),
      }`,
  );
  return `{
${lines.join(',\n')}
    }`;
}

function renderWorkflowInputMap(workflows: readonly WorkflowDefinitionIR[]): string {
  if (workflows.length === 0) {
    return 'extends Record<never, never> {}';
  }
  const lines = workflows.map(
    (workflow) => `  readonly ${JSON.stringify(workflow.name)}: ${workflow.name}Input;`,
  );
  return `{\n${lines.join('\n')}\n}`;
}

function renderWorkflowAccessorType(workflows: readonly WorkflowDefinitionIR[]): string {
  if (workflows.length === 0) {
    return 'extends Record<never, never> {}';
  }
  const lines = workflows.map(
    (workflow) => `  readonly ${JSON.stringify(workflow.name)}: {
    enqueue(input: ${workflow.name}Input): Promise<WorkflowRunRecord>;
    inspect(runId: string, input?: { readonly include?: WorkflowRunInclude }): Promise<WorkflowRunWithInclude | undefined>;
    replay(runId: string, options?: WorkflowReplayOptions): Promise<WorkflowRunRecord>;
  };`,
  );
  return `{\n${lines.join('\n')}\n}`;
}

function renderWorkflowTypeBlock(workflow: WorkflowDefinitionIR): string {
  const prefix = workflow.name;
  const stepNames = workflow.nodes
    .filter((node) => node.kind === 'step')
    .map((node) => JSON.stringify(node.name));
  const stepUnion = stepNames.length > 0 ? stepNames.join(' | ') : 'never';
  const stateFields = workflow.states.flatMap((state) => state.fields);
  const stateType = renderStateType(stateFields);
  const trigger = workflow.triggers[0];
  return `export interface ${prefix}Input extends Record<string, unknown> {}
export interface ${prefix}State ${stateType}
export interface ${prefix}Run {
  readonly workflow: ${JSON.stringify(workflow.name)};
  readonly state: ${prefix}State;
}
export type ${prefix}StepName = ${stepUnion};
export interface ${prefix}Event extends Record<string, unknown> {
  readonly source?: ${JSON.stringify(trigger?.source ?? 'manual')};
  readonly type?: ${JSON.stringify(trigger?.event ?? workflow.name)};
}`;
}

function renderStateType(fields: readonly WorkflowStateFieldIR[]): string {
  if (fields.length === 0) {
    return 'extends Record<string, unknown> {}';
  }
  const lines = fields.map((field) => {
    const optional = field.optional ? '?' : '';
    const type = field.list ? `readonly ${tsType(field.type)}[]` : tsType(field.type);
    return `  readonly ${field.name}${optional}: ${type};`;
  });
  return `{\n${lines.join('\n')}\n}`;
}

function tsType(type: string): string {
  switch (type) {
    case 'String':
    case 'DateTime':
      return 'string';
    case 'Int':
    case 'Float':
    case 'Decimal':
      return 'number';
    case 'Boolean':
      return 'boolean';
    case 'Json':
      return 'unknown';
    default:
      return 'unknown';
  }
}

async function writeGeneratedFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
