import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import type {
  WorkflowDefinitionIR,
  WorkflowManifest,
  WorkflowRunRecord,
  WorkflowStoreSnapshot,
} from '@prisma-next/workflows';
import type { CompileWorkflowSchemaResult } from '@prisma-next/workflows/compiler';
import {
  compileWorkflowSchema,
  generateWorkflowArtifacts,
  renderWorkflowSqlDdl,
} from '@prisma-next/workflows/compiler';
import {
  createWorkflowHttpApp,
  createWorkflowRuntime,
  InMemoryWorkflowStore,
  PostgresWorkflowStore,
  type WorkflowStepHandler,
} from '@prisma-next/workflows/runtime';
import {
  buildWorkflowStudioModel,
  renderWorkflowCanvasSvg,
  renderWorkflowStudioHtml,
} from '@prisma-next/workflows/studio';
import { Command } from 'commander';
import { dirname, join, relative, resolve } from 'pathe';
import {
  addGlobalOptions,
  setCommandDescriptions,
  setCommandExamples,
  setCommandSeeAlso,
} from '../utils/command-helpers';
import { type CommonCommandOptions, parseGlobalFlagsOrExit } from '../utils/global-flags';
import { createTerminalUI, type TerminalUI } from '../utils/terminal-ui';

interface WorkflowCommandOptions extends CommonCommandOptions {
  readonly schema?: string;
  readonly output?: string;
  readonly schemaName?: string;
  readonly fixture?: string;
  readonly studio?: string;
  readonly svg?: string;
  readonly payload?: string;
  readonly source?: string;
  readonly eventId?: string;
  readonly eventType?: string;
  readonly workflow?: string;
  readonly since?: string;
  readonly host?: string;
  readonly port?: string;
  readonly databaseUrl?: string;
  readonly fromStep?: string;
  readonly mode?: string;
  readonly confirmSideEffects?: boolean;
  readonly run?: boolean;
  readonly mock?: boolean;
  readonly once?: boolean;
  readonly force?: boolean;
}

interface LoadedWorkflowSchema {
  readonly schemaPath: string;
  readonly schemaText: string;
  readonly manifest: WorkflowManifest;
  readonly generator?: WorkflowGeneratorConfig;
}

interface WorkflowGeneratorConfig {
  readonly output?: string;
  readonly schemaName?: string;
}

interface WorkflowFixtureResult {
  readonly event: unknown;
  readonly runs: readonly WorkflowRunRecord[];
  readonly store: WorkflowStoreSnapshot;
}

interface WorkflowArtifactWriteInput {
  readonly manifest: WorkflowManifest;
  readonly outputDir: string;
  readonly schemaPath: string;
  readonly schemaName?: string;
}

type WorkflowDiagnostic = CompileWorkflowSchemaResult['diagnostics'][number];
type WorkflowInitWriteStatus = 'created' | 'updated' | 'overwritten' | 'kept';

interface WorkflowInitResult {
  readonly schemaPath: string;
  readonly fixturePath: string;
  readonly schemaStatus: WorkflowInitWriteStatus;
  readonly fixtureStatus: WorkflowInitWriteStatus;
  readonly commands: readonly string[];
}

interface WorkflowDevArtifactsResult {
  readonly outputDir: string;
  readonly studioPath: string;
  readonly commands: readonly string[];
  readonly summary: Record<string, unknown>;
}

interface DurableWorkflowRuntime {
  readonly runtime: ReturnType<typeof createWorkflowRuntime>;
  close(): Promise<void>;
}

const DEFAULT_OUTPUT_DIR = '.prisma-next/workflows';
const DEFAULT_INIT_SCHEMA_PATH = 'prisma/schema.prisma';

const WORKFLOW_STARTER_BLOCK = `model WorkflowDisputeCase {
  id               String   @id
  stripeDisputeId  String
  amountCents      Int
  customerEmail    String
  status           String
  draftResponse    String?
  approvedResponse String?
  evidenceId       String?
  createdAt        DateTime
  updatedAt        DateTime
}

model WorkflowApprovedDisputeResponse {
  id            String   @id
  disputeReason String
  amountCents   Int
  response      String
  confidence    Float
  approvedBy    String
  createdAt     DateTime
}

workflow StripeDisputeResponse {
  trigger stripeDisputeCreated {
    source = "stripe"
    event = "charge.dispute.created"
    dedupeBy = "event.data.object.id"
  }

  state DisputeCaseState {
    disputeId String @id
    customerId String
    customerEmail String?
    amount Int
    currency String
    reason String
    hubspotHistory Json?
    shopifyOrders Json?
    zendeskTickets Json?
    stripeMetadata Json?
    draftResponse String?
    approvedBy String?
    evidenceId String?
  }

  step collectCustomerHistory {
    run = "./src/steps/collect-customer-history.ts"
    checkpoint = true
    retry = { maxAttempts: 3, backoff: "exponential" }
  }

  step draftResponse {
    run = "./src/steps/draft-response.ts"
    checkpoint = true
    budget = { maxUsd: 1.25, maxTokens: 2000, timeout: "45s" }
  }

  approval humanApproval {
    when = "state.amount > 50000"
    assignees = ["role:finance_ops"]
    timeout = "48h"
    onApprove = submitEvidence
  }

  step submitEvidence {
    run = "./src/steps/submit-evidence.ts"
    checkpoint = true
    sideEffects = "external"
    idempotency = "state.disputeId"
  }

  step postSummary {
    run = "./src/steps/post-summary.ts"
    sideEffects = "external"
    idempotency = "state.disputeId"
  }

  step learnFromApproval {
    run = "./src/steps/learn-from-approved-response.ts"
    checkpoint = true
  }
}`;

const WORKFLOW_STARTER_FIXTURE = {
  id: 'evt_mock_dispute_created',
  type: 'charge.dispute.created',
  data: {
    object: {
      id: 'du_mock_001',
      amount: 72500,
      currency: 'usd',
      charge: 'ch_mock_001',
      customer: 'cus_mock_001',
      reason: 'fraudulent',
    },
  },
};

function addWorkflowSchemaOptions(command: Command): Command {
  return command
    .option('--schema <path>', 'Path to schema.prisma with native workflow blocks')
    .option(
      '--output <dir>',
      `Output directory for generated workflow artifacts (default: ${DEFAULT_OUTPUT_DIR})`,
    )
    .option('--schema-name <name>', 'Postgres schema for runtime tables');
}

function outputPath(
  options: WorkflowCommandOptions,
  generator: WorkflowGeneratorConfig | undefined,
): string {
  return resolve(options.output ?? generator?.output ?? DEFAULT_OUTPUT_DIR);
}

function workflowSchemaName(
  options: WorkflowCommandOptions,
  generator: WorkflowGeneratorConfig | undefined,
): string | undefined {
  return options.schemaName ?? generator?.schemaName;
}

function workflowArtifactWriteInput(
  loaded: LoadedWorkflowSchema,
  outputDir: string,
  options: WorkflowCommandOptions,
): WorkflowArtifactWriteInput {
  return {
    manifest: loaded.manifest,
    outputDir,
    schemaPath: loaded.schemaPath,
    ...ifWorkflowSchemaName(options, loaded.generator),
  };
}

function ifWorkflowSchemaName(
  options: WorkflowCommandOptions,
  generator: WorkflowGeneratorConfig | undefined,
): { readonly schemaName?: string } {
  const schemaName = workflowSchemaName(options, generator);
  return schemaName !== undefined ? { schemaName } : {};
}

function displayPath(path: string): string {
  return relative(process.cwd(), path) || path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function discoverSchemaPath(options: WorkflowCommandOptions): Promise<string> {
  if (options.schema) {
    return resolve(options.schema);
  }

  const candidates = [
    'schema.prisma',
    'schema.psl',
    'prisma/schema.prisma',
    'prisma/schema.psl',
    'src/schema.prisma',
    'src/schema.psl',
    'contract.prisma',
    'src/contract.prisma',
  ];
  for (const candidate of candidates) {
    const absolute = resolve(candidate);
    if (await exists(absolute)) {
      return absolute;
    }
  }

  throw new Error(
    'No workflow schema found. Pass --schema <path>, or create schema.prisma / schema.psl / prisma/schema.prisma / src/contract.prisma.',
  );
}

async function loadWorkflowSchema(options: WorkflowCommandOptions): Promise<LoadedWorkflowSchema> {
  const schemaPath = await discoverSchemaPath(options);
  const schemaText = await readFile(schemaPath, 'utf8');
  const sourceId = relative(process.cwd(), schemaPath) || schemaPath;
  const result = compileWorkflowSchema({
    schema: schemaText,
    sourceId,
  });
  if (!result.ok) {
    throw new Error(formatWorkflowDiagnostics(schemaPath, result.diagnostics));
  }
  return {
    schemaPath,
    schemaText,
    manifest: result.manifest,
    ...optionalGeneratorConfig(parseWorkflowGeneratorConfig(schemaText, dirname(schemaPath))),
  };
}

function optionalGeneratorConfig(generator: WorkflowGeneratorConfig | undefined): {
  readonly generator?: WorkflowGeneratorConfig;
} {
  return generator !== undefined ? { generator } : {};
}

function parseWorkflowGeneratorConfig(
  schemaText: string,
  schemaDir: string,
): WorkflowGeneratorConfig | undefined {
  const generatorBlock = findWorkflowGeneratorBlock(schemaText);
  if (!generatorBlock) return undefined;
  const output = generatorStringProperty(generatorBlock, 'output');
  const schemaName =
    generatorStringProperty(generatorBlock, 'schema') ??
    generatorStringProperty(generatorBlock, 'schemaName');
  return {
    ...(output !== undefined ? { output: resolve(schemaDir, output) } : {}),
    ...(schemaName !== undefined ? { schemaName } : {}),
  };
}

function findWorkflowGeneratorBlock(schemaText: string): string | undefined {
  const blockPattern = /(^|\n)\s*generator\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\s*\}/g;
  for (const match of schemaText.matchAll(blockPattern)) {
    const name = match[2];
    const body = match[3] ?? '';
    const provider = generatorStringProperty(body, 'provider');
    if (name === 'workflows' || provider === 'prisma-workflows') {
      return body;
    }
  }
  return undefined;
}

function generatorStringProperty(blockBody: string, key: string): string | undefined {
  const pattern = new RegExp(`(^|\\n)\\s*${key}\\s*=\\s*"([^"]+)"`);
  const match = blockBody.match(pattern);
  return match?.[2];
}

function formatWorkflowDiagnostics(
  schemaPath: string,
  diagnostics: readonly WorkflowDiagnostic[],
): string {
  const schemaLabel = displayPath(schemaPath);
  if (diagnostics.length === 0) {
    return `Workflow schema ${schemaLabel} did not parse. Fix the schema and rerun \`prisma-next workflow compile --schema ${schemaLabel}\`.`;
  }
  const lines = [`Workflow schema has ${diagnostics.length} diagnostic(s):`];
  for (const diagnostic of diagnostics) {
    lines.push(
      `- ${schemaLabel}:${diagnostic.span.start.line}:${diagnostic.span.start.column} [${diagnostic.code}] ${diagnostic.message}`,
    );
  }
  lines.push(
    '',
    `Fix the schema and rerun \`prisma-next workflow compile --schema ${schemaLabel}\`.`,
  );
  return lines.join('\n');
}

function containsWorkflowBlock(schemaText: string): boolean {
  return /(^|\n)\s*workflow\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/.test(schemaText);
}

async function writeStarterSchema(path: string, force: boolean): Promise<WorkflowInitWriteStatus> {
  const alreadyExists = await exists(path);
  if (!alreadyExists || force) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${WORKFLOW_STARTER_BLOCK}\n`);
    return alreadyExists ? 'overwritten' : 'created';
  }

  const current = await readFile(path, 'utf8');
  if (containsWorkflowBlock(current)) {
    return 'kept';
  }

  await writeFile(path, `${current.trimEnd()}\n\n${WORKFLOW_STARTER_BLOCK}\n`);
  return 'updated';
}

async function writeStarterFixture(path: string, force: boolean): Promise<WorkflowInitWriteStatus> {
  const alreadyExists = await exists(path);
  if (alreadyExists && !force) {
    return 'kept';
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(WORKFLOW_STARTER_FIXTURE, null, 2)}\n`);
  return alreadyExists ? 'overwritten' : 'created';
}

async function initWorkflowProject(options: WorkflowCommandOptions): Promise<WorkflowInitResult> {
  const schemaPath = resolve(options.schema ?? DEFAULT_INIT_SCHEMA_PATH);
  const fixturePath = resolve(
    options.fixture ?? join(dirname(schemaPath), 'workflows/fixtures/stripe-dispute-created.json'),
  );
  const force = options.force === true;
  const schemaStatus = await writeStarterSchema(schemaPath, force);
  const fixtureStatus = await writeStarterFixture(fixturePath, force);
  const schemaArg = displayPath(schemaPath);
  const fixtureArg = displayPath(fixturePath);
  return {
    schemaPath: schemaArg,
    fixturePath: fixtureArg,
    schemaStatus,
    fixtureStatus,
    commands: [
      `prisma-next workflow generate --schema ${schemaArg}`,
      `prisma-next workflow test --schema ${schemaArg} --payload ${fixtureArg} --mock`,
      `prisma-next workflow inspect --schema ${schemaArg} --studio .prisma-next/workflows/studio.html`,
    ],
  };
}

function manifestSummary(manifest: WorkflowManifest): Record<string, unknown> {
  return {
    kind: manifest.kind,
    version: manifest.version,
    workflowCount: manifest.workflows.length,
    workflows: manifest.workflows.map((workflow) => ({
      name: workflow.name,
      slug: workflow.slug,
      version: workflow.version,
      trigger: primaryTrigger(workflow),
      stateFields: workflow.states.flatMap((state) => state.fields.map((field) => field.name)),
      nodeCount: workflow.nodes.length,
      approvalCount: workflow.nodes.filter((node) => node.kind === 'approval').length,
    })),
  };
}

function formatManifestSummary(schemaPath: string, manifest: WorkflowManifest): string {
  const lines = [
    `Schema: ${relative(process.cwd(), schemaPath) || schemaPath}`,
    `Workflows: ${manifest.workflows.length}`,
  ];
  for (const workflow of manifest.workflows) {
    const steps = workflow.nodes.filter((node) => node.kind === 'step').length;
    const approvals = workflow.nodes.filter((node) => node.kind === 'approval').length;
    const trigger = primaryTrigger(workflow);
    lines.push(
      `- ${workflow.name} (${workflow.slug}): trigger ${trigger.source}.${trigger.event}; ${steps} step(s), ${approvals} approval(s)`,
    );
  }
  return lines.join('\n');
}

function primaryTrigger(workflow: WorkflowDefinitionIR): {
  readonly source: string;
  readonly event: string;
} {
  return workflow.triggers[0] ?? { source: 'manual', event: 'manual' };
}

async function writeStudioArtifacts(
  manifest: WorkflowManifest,
  options: WorkflowCommandOptions,
  generator: WorkflowGeneratorConfig | undefined,
  ui: TerminalUI,
): Promise<void> {
  const studioPath = resolve(options.studio ?? join(outputPath(options, generator), 'studio.html'));
  await mkdir(dirname(studioPath), { recursive: true });
  await writeFile(studioPath, renderWorkflowStudioHtml(manifest));

  for (const workflow of manifest.workflows) {
    const svgPath =
      manifest.workflows.length === 1
        ? resolve(options.svg ?? join(outputPath(options, generator), 'workflow-canvas.svg'))
        : resolve(options.svg ?? join(outputPath(options, generator), `${workflow.slug}.svg`));
    await mkdir(dirname(svgPath), { recursive: true });
    await writeFile(svgPath, renderWorkflowCanvasSvg(workflow.canvas));
    ui.info(`Wrote ${relative(process.cwd(), svgPath)}`);
  }

  ui.info(`Wrote ${relative(process.cwd(), studioPath)}`);
}

async function readPayload(path: string | undefined): Promise<Record<string, unknown>> {
  if (!path) {
    return {
      id: 'evt_mock_dispute_created',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'du_mock_001',
          amount: 72500,
          currency: 'usd',
          charge: 'ch_mock_001',
          customer: 'cus_mock_001',
          reason: 'fraudulent',
        },
      },
    };
  }

  const text = await readFile(resolve(path), 'utf8');
  const payload: unknown = JSON.parse(text);
  const record = recordValue(payload);
  if (!record) {
    throw new Error('Workflow payload must be a JSON object.');
  }
  return record;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

function createCliMockHandler(): WorkflowStepHandler {
  return async (context) => {
    const input = recordValue(context.input) ?? {};
    const dispute = recordValue(recordValue(input['data'])?.['object']) ?? {};
    const disputeId =
      typeof context.state['disputeId'] === 'string'
        ? context.state['disputeId']
        : typeof dispute['id'] === 'string'
          ? dispute['id']
          : typeof input['id'] === 'string'
            ? input['id']
            : context.run.id;
    const accountId =
      typeof context.state['accountId'] === 'string'
        ? context.state['accountId']
        : typeof input['accountId'] === 'string'
          ? input['accountId']
          : context.run.id;

    switch (context.step.name) {
      case 'collectCustomerHistory':
        return {
          disputeId,
          customerId: String(dispute['customer'] ?? 'cus_mock_001'),
          customerEmail: 'billing@example.test',
          amount: Number(dispute['amount'] ?? 72500),
          currency: String(dispute['currency'] ?? 'usd'),
          reason: String(dispute['reason'] ?? 'fraudulent'),
          hubspotHistory: { lifecycleStage: 'customer', previousDisputes: 0 },
          shopifyOrders: [{ orderId: 'ord_mock_001', trackingNumber: '1ZMOCK' }],
          zendeskTickets: [{ ticketId: 'zd_mock_001', status: 'solved' }],
          stripeMetadata: { receiptEmail: 'billing@example.test' },
        };
      case 'enrichAccount':
        return {
          accountId,
          companyDomain: String(input['companyDomain'] ?? 'example.test'),
          crmAccount: { segment: 'enterprise', owner: 'sales-ops@example.test' },
          billingProfile: { annualContractValue: 180000, paymentVerified: true },
          identitySignals: { seatRequestSpike: true, disposableEmail: false },
        };
      case 'scoreRisk':
        return {
          riskScore: 0.82,
          provisioningPlan: { seats: 250, requiresSalesOps: true },
        };
      case 'draftResponse':
      case 'draftEvidence':
        return {
          disputeId,
          draft: `Evidence packet drafted for ${disputeId}.`,
          confidence: 0.92,
          source: 'cli-mock',
        };
      case 'submitEvidence':
        return {
          disputeId,
          submitted: true,
          provider: 'stripe',
          evidenceId: `ev_${context.run.id.slice(0, 8)}`,
        };
      case 'postSummary':
      case 'notifySlack':
        return {
          disputeId,
          accountId,
          channel: '#disputes',
          posted: true,
        };
      case 'provisionWorkspace':
        return {
          workspace: { workspaceId: `workspace_${accountId}`, region: 'us-east-1' },
        };
      case 'learnFromApproval':
        return {
          approvedResponse: context.state['draftResponse'] ?? context.state['draft'],
          learnedExample: { response: context.state['draftResponse'] ?? context.state['draft'] },
        };
      default:
        return {
          ok: true,
          step: context.step.name,
          stateKeys: Object.keys(context.state),
        };
    }
  };
}

function workflowStepNodes(manifest: WorkflowManifest) {
  return manifest.workflows.flatMap((workflow) =>
    workflow.nodes.filter((node) => node.kind === 'step'),
  );
}

function createMockStepHandlers(manifest: WorkflowManifest): Record<string, WorkflowStepHandler> {
  const stepHandler = createCliMockHandler();
  return Object.fromEntries(workflowStepNodes(manifest).map((step) => [step.name, stepHandler]));
}

async function loadStepHandlers(
  loaded: LoadedWorkflowSchema,
  options: WorkflowCommandOptions,
): Promise<Record<string, WorkflowStepHandler>> {
  if (options.mock === true) {
    return createMockStepHandlers(loaded.manifest);
  }

  const handlers: Record<string, WorkflowStepHandler> = {};
  for (const step of workflowStepNodes(loaded.manifest)) {
    const handler = await loadStepHandler(loaded.schemaPath, step.name, step.run);
    handlers[step.name] = handler;
    handlers[step.run] = handler;
  }
  return handlers;
}

async function loadStepHandler(
  schemaPath: string,
  stepName: string,
  runPath: string,
): Promise<WorkflowStepHandler> {
  const moduleSpecifier = await resolveStepModuleSpecifier(schemaPath, runPath);
  let moduleValue: unknown;
  try {
    moduleValue = await importStepModule(moduleSpecifier);
  } catch (error) {
    throw new Error(
      `Failed to load workflow step "${stepName}" from ${runPath}: ${error instanceof Error ? error.message : String(error)}\n` +
        'Use --mock for fixture-only runs, or point `run` at a module exporting default, run, handler, or step.',
    );
  }
  const moduleRecord = recordValue(moduleValue);
  if (!moduleRecord) {
    throw new Error(`Workflow step module "${runPath}" did not evaluate to an object.`);
  }
  const candidate =
    moduleRecord['default'] ??
    moduleRecord['run'] ??
    moduleRecord['handler'] ??
    moduleRecord['step'];
  if (typeof candidate !== 'function') {
    throw new Error(
      `Workflow step "${stepName}" module ${runPath} must export a function as default, run, handler, or step.`,
    );
  }
  return async (context) => {
    const output: unknown = await candidate(context);
    if (output === undefined) {
      return undefined;
    }
    const outputRecord = recordValue(output);
    if (!outputRecord) {
      throw new Error(`Workflow step "${stepName}" returned ${typeof output}; expected an object.`);
    }
    return outputRecord;
  };
}

async function importStepModule(moduleSpecifier: string): Promise<unknown> {
  if (
    moduleSpecifier.startsWith('file:') &&
    (moduleSpecifier.endsWith('.ts') || moduleSpecifier.endsWith('.tsx'))
  ) {
    const { tsImport } = await import('tsx/esm/api');
    return tsImport(moduleSpecifier, import.meta.url);
  }
  return import(moduleSpecifier);
}

async function resolveStepModuleSpecifier(schemaPath: string, runPath: string): Promise<string> {
  if (runPath.startsWith('@') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(runPath)) {
    return runPath;
  }
  const candidates = runPath.startsWith('/')
    ? [runPath]
    : [resolve(runPath), resolve(dirname(schemaPath), runPath)];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  throw new Error(
    `Workflow step module not found for \`${runPath}\`. Looked in ${candidates
      .map(displayPath)
      .join(', ')}.\nUse --mock for fixture-only runs, or point \`run\` at an existing module.`,
  );
}

async function runFixture(
  loaded: LoadedWorkflowSchema,
  options: WorkflowCommandOptions,
): Promise<WorkflowFixtureResult> {
  const payload = await readPayload(options.payload);
  const store = new InMemoryWorkflowStore();
  const steps = await loadStepHandlers(loaded, options);
  const runtime = createWorkflowRuntime({
    manifest: loaded.manifest,
    store,
    steps,
  });
  const trigger = loaded.manifest.workflows[0]
    ? primaryTrigger(loaded.manifest.workflows[0])
    : undefined;
  const source = options.source ?? trigger?.source ?? 'mock';
  const eventType = options.eventType ?? trigger?.event ?? 'event';
  const event = await runtime.ingest({
    source,
    eventType,
    ...(options.eventId !== undefined ? { externalId: options.eventId } : {}),
    payload,
  });
  const runs = await runtime.runUntilIdle();
  return {
    event,
    runs,
    store: await runtime.snapshot(),
  };
}

function databaseUrl(options: WorkflowCommandOptions): string | undefined {
  return options.databaseUrl ?? process.env['DATABASE_URL'];
}

function requireDatabaseUrl(options: WorkflowCommandOptions, commandName: string): string {
  const value = databaseUrl(options);
  if (!value) {
    throw new Error(
      `${commandName} requires a database connection. Set DATABASE_URL or pass --database-url <url>.`,
    );
  }
  return value;
}

async function createDurableWorkflowRuntime(
  loaded: LoadedWorkflowSchema,
  options: WorkflowCommandOptions,
  loadSteps = true,
): Promise<DurableWorkflowRuntime> {
  const store = new PostgresWorkflowStore({
    connectionString: requireDatabaseUrl(options, 'workflow durable command'),
    ...ifWorkflowSchemaName(options, loaded.generator),
  });
  const steps = loadSteps ? await loadStepHandlers(loaded, options) : {};
  const runtime = createWorkflowRuntime({
    manifest: loaded.manifest,
    store,
    steps,
  });
  return {
    runtime,
    close: () => store.close(),
  };
}

async function inspectDurableRun(
  loaded: LoadedWorkflowSchema,
  options: WorkflowCommandOptions,
  runId: string,
): Promise<Record<string, unknown>> {
  const durable = await createDurableWorkflowRuntime(loaded, options, false);
  try {
    const run = await durable.runtime.inspect(runId, {
      steps: true,
      timeline: true,
      stateSnapshots: true,
      approvals: true,
      outbox: true,
      deadLetters: true,
    });
    return run ? { run } : { run: null };
  } finally {
    await durable.close();
  }
}

function workflowReplayMode(value: string | undefined) {
  return value === 'recorded' || value === 'resume' || value === 'reexecute' || value === 'fork'
    ? value
    : undefined;
}

async function replayDurableRun(
  loaded: LoadedWorkflowSchema,
  options: WorkflowCommandOptions,
  runId: string,
): Promise<Record<string, unknown>> {
  const durable = await createDurableWorkflowRuntime(loaded, options);
  try {
    const mode = workflowReplayMode(options.mode);
    const run = await durable.runtime.replay(runId, {
      ...(options.fromStep !== undefined ? { fromStep: options.fromStep } : {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(options.confirmSideEffects === true ? { confirmSideEffects: true } : {}),
    });
    return {
      replayed: true,
      run,
      processedRuns: await durable.runtime.runUntilIdle(),
    };
  } finally {
    await durable.close();
  }
}

async function prepareWorkflowDevArtifacts(
  loaded: LoadedWorkflowSchema,
  options: WorkflowCommandOptions,
  ui: TerminalUI,
): Promise<WorkflowDevArtifactsResult> {
  const outDir = outputPath(options, loaded.generator);
  const studioPath = resolve(options.studio ?? join(outDir, 'studio.html'));
  await generateWorkflowArtifacts(workflowArtifactWriteInput(loaded, outDir, options));
  await writeStudioArtifacts(loaded.manifest, options, loaded.generator, ui);
  const schemaArg = relative(process.cwd(), loaded.schemaPath) || loaded.schemaPath;
  return {
    outputDir: outDir,
    studioPath,
    commands: [
      `prisma-next workflow test --schema ${schemaArg}`,
      `prisma-next workflow ingest --schema ${schemaArg} --payload fixtures/event.json`,
      `open ${relative(process.cwd(), studioPath) || studioPath}`,
    ],
    summary: manifestSummary(loaded.manifest),
  };
}

async function startWorkflowDevServer(
  loaded: LoadedWorkflowSchema,
  options: WorkflowCommandOptions,
  ui: TerminalUI,
): Promise<void> {
  const store = new InMemoryWorkflowStore();
  const steps = await loadStepHandlers(loaded, options);
  const runtime = createWorkflowRuntime({
    manifest: loaded.manifest,
    store,
    steps,
  });
  const app = createWorkflowHttpApp({
    manifest: loaded.manifest,
    runtime,
  });
  const host = options.host ?? '127.0.0.1';
  const port = parsePortOption(options.port);
  const server = createServer((request, response) => {
    void handleWorkflowDevRequest(app, request, response);
  });
  await listen(server, host, port);
  const origin = `http://${urlHost(host)}:${listeningPort(server)}`;
  const timer = setInterval(() => {
    void runtime.runUntilIdle().catch((error: unknown) => {
      ui.warn(`Workflow worker tick failed: ${errorMessage(error)}`);
    });
  }, 1_000);
  timer.unref();
  ui.success(`Workflow dev server running at ${origin}`);
  ui.info(`Studio data: ${origin}/api/prisma-workflows/studio`);
  ui.info(`Ingest: POST ${origin}/api/prisma-workflows/ingest/:source`);
  ui.note('Press Ctrl+C to stop.', 'Workflow dev');
  await waitForServerShutdown(server);
  clearInterval(timer);
  ui.info('Workflow dev server stopped.');
}

async function handleWorkflowDevRequest(
  app: { fetch(request: Request): Promise<Response> },
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const fetchResponse = await app.fetch(await fetchRequestFromNode(request));
    response.statusCode = fetchResponse.status;
    fetchResponse.headers.forEach((value, key) => {
      response.setHeader(key, value);
    });
    response.end(Buffer.from(await fetchResponse.arrayBuffer()));
  } catch (error) {
    response.statusCode = 500;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: errorMessage(error) }));
  }
}

async function fetchRequestFromNode(request: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  const host = headers.get('host') ?? '127.0.0.1';
  const url = `http://${host}${request.url ?? '/'}`;
  const method = request.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await nodeRequestBody(request);
  return new Request(url, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

async function nodeRequestBody(request: IncomingMessage): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(chunk);
    }
  }
  const buffer = Buffer.concat(chunks);
  const body = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(body).set(buffer);
  return new Blob([body]);
}

function parsePortOption(value: string | undefined): number {
  const port = value === undefined ? 5555 : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid workflow dev port: ${value}`);
  }
  return port;
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
}

function listeningPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Workflow dev server did not expose a TCP address.');
  }
  return address.port;
}

function urlHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function waitForServerShutdown(server: Server): Promise<void> {
  return new Promise((resolveShutdown, rejectShutdown) => {
    const cleanup = () => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      server.off('error', rejectShutdown);
    };
    const finish = (error?: Error) => {
      cleanup();
      if (error) {
        rejectShutdown(error);
      } else {
        resolveShutdown();
      }
    };
    const shutdown = () => {
      server.close(finish);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    server.once('error', rejectShutdown);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorkflowCommand(): Command {
  const command = new Command('workflow');
  setCommandDescriptions(
    command,
    'Compile and run Prisma Workflow definitions',
    'Prisma Workflow turns native `workflow` blocks in schema.prisma into a typed manifest,\n' +
      'durable Postgres runtime tables, Compute entrypoints, local fixture runs, and Studio\n' +
      'canvas data for debugging automations.',
  );
  setCommandExamples(command, [
    'prisma-next workflow init --schema prisma/schema.prisma',
    'prisma-next workflow compile --schema prisma/schema.prisma',
    'prisma-next workflow generate --schema prisma/schema.prisma --output src/generated/workflows',
    'prisma-next workflow test --schema prisma/schema.prisma --payload fixtures/dispute.json',
    'prisma-next workflow inspect --schema prisma/schema.prisma --studio .prisma-next/workflows/studio.html',
  ]);

  const initCommand = new Command('init');
  setCommandDescriptions(
    initCommand,
    'Scaffold a Prisma Workflow schema and local event fixture',
    'Creates prisma/schema.prisma when missing, appends a Stripe dispute workflow when the\n' +
      'schema has no workflow blocks, and writes a JSON fixture that can be used with\n' +
      '`workflow test` immediately.',
  );
  setCommandExamples(initCommand, [
    'prisma-next workflow init',
    'prisma-next workflow init --schema src/schema.prisma',
    'prisma-next workflow init --schema prisma/schema.prisma --force',
  ]);
  addGlobalOptions(initCommand)
    .option('--schema <path>', 'Schema path to create or update', DEFAULT_INIT_SCHEMA_PATH)
    .option(
      '--fixture <path>',
      'JSON event fixture path (default: <schema-dir>/workflows/fixtures/stripe-dispute-created.json)',
    )
    .option('--force', 'Overwrite existing starter schema and fixture files')
    .action(async (options: WorkflowCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const result = await initWorkflowProject(options);
      if (flags.json) {
        ui.output(JSON.stringify(result, null, 2));
      } else {
        ui.success('Prisma Workflow scaffold is ready.');
        ui.info(`Schema ${result.schemaStatus}: ${result.schemaPath}`);
        ui.info(`Fixture ${result.fixtureStatus}: ${result.fixturePath}`);
        ui.note(result.commands.join('\n'), 'Next commands');
      }
    });

  const compileCommand = new Command('compile');
  setCommandDescriptions(
    compileCommand,
    'Compile workflow blocks and print a summary',
    'Parses native Prisma Workflow blocks and emits a manifest summary. Use --json to get\n' +
      'the full compiled manifest and diagnostic metadata.',
  );
  setCommandExamples(compileCommand, [
    'prisma-next workflow compile --schema prisma/schema.prisma',
    'prisma-next workflow compile --schema prisma/schema.prisma --json',
  ]);
  addWorkflowSchemaOptions(addGlobalOptions(compileCommand)).action(
    async (options: WorkflowCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const loaded = await loadWorkflowSchema(options);
      if (flags.json) {
        ui.output(
          JSON.stringify(
            {
              schemaPath: loaded.schemaPath,
              ...manifestSummary(loaded.manifest),
              manifest: loaded.manifest,
            },
            null,
            2,
          ),
        );
      } else {
        ui.log(formatManifestSummary(loaded.schemaPath, loaded.manifest));
      }
    },
  );

  const generateCommand = new Command('generate');
  setCommandDescriptions(
    generateCommand,
    'Generate workflow runtime, DDL, Compute, and Studio artifacts',
    'Writes manifest.json, index.ts, index.d.ts, schema.sql, studio.json, compute.ts,\n' +
      'studio.html, and workflow canvas SVG files into the output directory.',
  );
  setCommandExamples(generateCommand, [
    'prisma-next workflow generate --schema prisma/schema.prisma',
    'prisma-next workflow generate --schema prisma/schema.prisma --output src/generated/workflows',
  ]);
  addWorkflowSchemaOptions(addGlobalOptions(generateCommand))
    .option('--studio <path>', 'Path for the generated static Studio HTML')
    .option(
      '--svg <path>',
      'Path for the generated workflow canvas SVG when one workflow is present',
    )
    .action(async (options: WorkflowCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const loaded = await loadWorkflowSchema(options);
      const outDir = outputPath(options, loaded.generator);
      const files = await generateWorkflowArtifacts(
        workflowArtifactWriteInput(loaded, outDir, options),
      );
      await writeStudioArtifacts(loaded.manifest, options, loaded.generator, ui);
      const result = {
        outputDir: outDir,
        files: Object.keys(files).map((file) => file),
        ...manifestSummary(loaded.manifest),
      };
      if (flags.json) {
        ui.output(JSON.stringify(result, null, 2));
      } else {
        ui.success(`Generated workflows in ${relative(process.cwd(), outDir) || outDir}`);
      }
    });

  const ddlCommand = new Command('ddl');
  setCommandDescriptions(
    ddlCommand,
    'Print the Postgres DDL for Workflow runtime tables',
    'Emits the `_prisma_workflows` schema tables used by the durable runtime: definitions,\n' +
      'versions, ingest events, runs, step runs, timelines, approvals, timers, outbox,\n' +
      'dead letters, connector state, canvas layouts, and artifacts.',
  );
  setCommandExamples(ddlCommand, [
    'prisma-next workflow ddl > workflows.sql',
    'prisma-next workflow ddl --schema prisma/schema.prisma > workflows.sql',
    'prisma-next workflow ddl --schema-name workflow_runtime > workflows.sql',
  ]);
  addGlobalOptions(ddlCommand)
    .option('--schema <path>', 'Optional schema.prisma for generator workflows defaults')
    .option('--schema-name <name>', 'Postgres schema for runtime tables')
    .action(async (options: WorkflowCommandOptions) => {
      parseGlobalFlagsOrExit(options);
      const generator =
        options.schema !== undefined
          ? parseWorkflowGeneratorConfig(
              await readFile(resolve(options.schema), 'utf8'),
              dirname(resolve(options.schema)),
            )
          : undefined;
      process.stdout.write(renderWorkflowSqlDdl(workflowSchemaName(options, generator)));
    });

  const inspectCommand = new Command('inspect');
  setCommandDescriptions(
    inspectCommand,
    'Inspect Studio canvas data for compiled workflows',
    'With no run id, builds the workflow list and canvas model consumed by Studio. With a\n' +
      'run id, reads the durable Postgres store and prints the run, steps, timeline, snapshots,\n' +
      'approvals, outbox, and dead-letter rows for that execution.',
  );
  setCommandExamples(inspectCommand, [
    'prisma-next workflow inspect --schema prisma/schema.prisma --json',
    'prisma-next workflow inspect run_123 --schema prisma/schema.prisma --database-url "$DATABASE_URL" --json',
    'prisma-next workflow inspect --schema prisma/schema.prisma --studio .prisma-next/workflows/studio.html',
  ]);
  addWorkflowSchemaOptions(addGlobalOptions(inspectCommand))
    .argument('[runId]', 'Durable workflow run id to inspect')
    .option('--database-url <url>', 'Postgres connection string for durable run inspection')
    .option('--studio <path>', 'Path for generated static Studio HTML')
    .option('--svg <path>', 'Path for generated workflow canvas SVG when one workflow is present')
    .action(async (runId: string | undefined, options: WorkflowCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const loaded = await loadWorkflowSchema(options);
      if (runId !== undefined) {
        const result = await inspectDurableRun(loaded, options, runId);
        if (flags.json) {
          ui.output(JSON.stringify(result, null, 2));
        } else {
          const run = recordValue(result['run']);
          ui.log(`${runId}: ${String(run?.['status'] ?? 'not found')}`);
        }
        return;
      }
      const model = buildWorkflowStudioModel(loaded.manifest);
      if (options.studio || options.svg) {
        await writeStudioArtifacts(loaded.manifest, options, loaded.generator, ui);
      }
      if (flags.json) {
        ui.output(JSON.stringify(model, null, 2));
      } else {
        ui.log(formatManifestSummary(loaded.schemaPath, loaded.manifest));
      }
    });

  const testCommand = new Command('test');
  setCommandDescriptions(
    testCommand,
    'Run workflows locally against a JSON fixture',
    'Uses the in-memory Workflow runtime and loads each step module from its `run` path.\n' +
      'Pass --mock for deterministic provider-free handlers when testing a scaffold.',
  );
  setCommandExamples(testCommand, [
    'prisma-next workflow test --schema prisma/schema.prisma --payload fixtures/dispute.json',
    'prisma-next workflow test --schema prisma/schema.prisma --payload fixtures/dispute.json --mock --json',
  ]);
  addWorkflowSchemaOptions(addGlobalOptions(testCommand))
    .option('--payload <path>', 'JSON event fixture to ingest')
    .option('--source <name>', 'Event source override')
    .option('--event-type <type>', 'Event type override')
    .option('--event-id <id>', 'Event id override')
    .option('--mock', 'Use deterministic built-in step handlers instead of loading run modules')
    .action(async (options: WorkflowCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const loaded = await loadWorkflowSchema(options);
      const result = await runFixture(loaded, options);
      if (flags.json) {
        ui.output(JSON.stringify(result, null, 2));
      } else {
        const { runs } = result;
        ui.log(`Ingested event and ran ${runs.length} workflow run(s).`);
        for (const run of runs) {
          ui.log(`- ${run.id}: ${run.status}`);
        }
      }
    });

  const ingestCommand = new Command('ingest');
  setCommandDescriptions(
    ingestCommand,
    'Ingest one event fixture into the local Workflow runtime',
    'Alias of workflow test for local webhook development. It compiles the schema, enqueues\n' +
      'a fixture payload, loads step modules, and advances the in-memory worker until blocked or done.',
  );
  setCommandExamples(ingestCommand, [
    'prisma-next workflow ingest --schema prisma/schema.prisma --payload fixtures/dispute.json',
    'prisma-next workflow ingest --schema prisma/schema.prisma --payload fixtures/dispute.json --mock',
  ]);
  addWorkflowSchemaOptions(addGlobalOptions(ingestCommand))
    .option('--payload <path>', 'JSON event fixture to ingest')
    .option('--source <name>', 'Event source override')
    .option('--event-type <type>', 'Event type override')
    .option('--event-id <id>', 'Event id override')
    .option('--mock', 'Use deterministic built-in step handlers instead of loading run modules')
    .action(async (options: WorkflowCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const loaded = await loadWorkflowSchema(options);
      const result = await runFixture(loaded, options);
      if (flags.json) {
        ui.output(JSON.stringify(result, null, 2));
      } else {
        ui.success('Event ingested into local Workflow runtime.');
      }
    });

  const devCommand = new Command('dev');
  setCommandDescriptions(
    devCommand,
    'Run a local Workflow worker and Studio API',
    'Compiles workflows, writes generated runtime artifacts, loads real step modules, and\n' +
      'starts a local HTTP app with webhook ingest, approvals, replay, health, and Studio data.',
  );
  setCommandExamples(devCommand, [
    'prisma-next workflow dev --schema prisma/schema.prisma',
    'prisma-next workflow dev --schema prisma/schema.prisma --mock',
    'prisma-next workflow dev --schema prisma/schema.prisma --once --json',
  ]);
  addWorkflowSchemaOptions(addGlobalOptions(devCommand))
    .option('--host <host>', 'Host for the local Workflow HTTP app', '127.0.0.1')
    .option('--port <port>', 'Port for the local Workflow HTTP app', '5555')
    .option('--mock', 'Use deterministic built-in step handlers instead of loading run modules')
    .option('--once', 'Generate dev artifacts and exit without starting the local server')
    .action(async (options: WorkflowCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const loaded = await loadWorkflowSchema(options);
      const artifacts = await prepareWorkflowDevArtifacts(loaded, options, ui);
      const result = {
        outputDir: artifacts.outputDir,
        studioPath: artifacts.studioPath,
        commands: artifacts.commands,
        server:
          options.once === true || flags.json
            ? null
            : {
                host: options.host ?? '127.0.0.1',
                port: parsePortOption(options.port),
              },
        ...artifacts.summary,
      };
      if (flags.json || options.once === true) {
        if (flags.json) {
          ui.output(JSON.stringify(result, null, 2));
        } else {
          ui.success(
            `Workflow dev artifacts ready in ${relative(process.cwd(), artifacts.outputDir) || artifacts.outputDir}`,
          );
          ui.note(result.commands.join('\n'), 'Next commands');
        }
        return;
      }
      await startWorkflowDevServer(loaded, options, ui);
    });

  const replayCommand = new Command('replay');
  setCommandDescriptions(
    replayCommand,
    'Replay a durable run or fixture event',
    'With a run id, forks/resumes/re-executes a durable Postgres run. Without a run id, compiles\n' +
      'the current manifest and re-runs a JSON fixture through real step modules by default.',
  );
  setCommandExamples(replayCommand, [
    'prisma-next workflow replay run_123 --schema prisma/schema.prisma --database-url "$DATABASE_URL" --json',
    'prisma-next workflow replay --schema prisma/schema.prisma --payload fixtures/dispute.json',
    'prisma-next workflow replay --schema prisma/schema.prisma --payload fixtures/dispute.json --mock',
  ]);
  addWorkflowSchemaOptions(addGlobalOptions(replayCommand))
    .argument('[runId]', 'Durable workflow run id to replay')
    .option('--payload <path>', 'JSON event fixture to replay')
    .option('--source <name>', 'Event source override')
    .option('--event-type <type>', 'Event type override')
    .option('--event-id <id>', 'Event id override')
    .option('--database-url <url>', 'Postgres connection string for durable run replay')
    .option('--from-step <name>', 'Replay from a step name or node id')
    .option('--mode <mode>', 'Replay mode: fork, recorded, resume, or reexecute')
    .option('--confirm-side-effects', 'Allow re-executing external side effects when requested')
    .option('--mock', 'Use deterministic built-in step handlers instead of loading run modules')
    .action(async (runId: string | undefined, options: WorkflowCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const loaded = await loadWorkflowSchema(options);
      if (runId !== undefined) {
        const result = await replayDurableRun(loaded, options, runId);
        if (flags.json) {
          ui.output(JSON.stringify(result, null, 2));
        } else {
          const run = recordValue(result['run']);
          ui.success(`Replay queued from ${runId}: ${String(run?.['id'] ?? 'unknown run')}`);
        }
        return;
      }
      const result = await runFixture(loaded, options);
      if (flags.json) {
        ui.output(JSON.stringify({ replayed: true, ...result }, null, 2));
      } else {
        ui.success('Fixture replay completed.');
      }
    });

  const backfillCommand = new Command('backfill');
  setCommandDescriptions(
    backfillCommand,
    'Plan or persist a connector backfill for a workflow trigger',
    'Validates the workflow manifest and prints the cursor/backfill request. When --payload is\n' +
      'provided with DATABASE_URL or --database-url, the payload is written through the same\n' +
      'durable ingest path used by webhooks.',
  );
  setCommandExamples(backfillCommand, [
    'prisma-next workflow backfill --schema prisma/schema.prisma --workflow DisputeEvidence --since 2026-01-01',
    'prisma-next workflow backfill --schema prisma/schema.prisma --payload fixtures/dispute.json --database-url "$DATABASE_URL" --run --json',
  ]);
  addWorkflowSchemaOptions(addGlobalOptions(backfillCommand))
    .option('--workflow <name>', 'Workflow name to backfill')
    .option('--since <date>', 'Inclusive lower bound for provider events')
    .option('--payload <path>', 'JSON event payload to persist as a backfilled ingest event')
    .option('--event-id <id>', 'Provider event id for the persisted backfill payload')
    .option('--database-url <url>', 'Postgres connection string for durable backfill ingest')
    .option('--run', 'Persist the backfill instead of printing a plan')
    .action(async (options: WorkflowCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const loaded = await loadWorkflowSchema(options);
      const workflow =
        loaded.manifest.workflows.find((candidate) => candidate.name === options.workflow) ??
        loaded.manifest.workflows[0];
      if (!workflow) {
        throw new Error('No workflows found to backfill.');
      }
      const request = {
        workflow: workflow.name,
        source: primaryTrigger(workflow).source,
        event: primaryTrigger(workflow).event,
        since: options.since ?? null,
        cursorTable: `${workflowSchemaName(options, loaded.generator) ?? '_prisma_workflows'}."WorkflowConnectorCursor"`,
      };
      if (options.payload !== undefined && options.run === true) {
        const durable = await createDurableWorkflowRuntime(loaded, options);
        try {
          const payload = await readPayload(options.payload);
          const result = await durable.runtime.ingest({
            source: request.source,
            eventType: request.event,
            payload,
            ...(options.eventId !== undefined ? { externalId: options.eventId } : {}),
          });
          const output = {
            ...request,
            persisted: true,
            ingest: result,
            processedRuns: await durable.runtime.runUntilIdle(),
          };
          if (flags.json) {
            ui.output(JSON.stringify(output, null, 2));
          } else {
            ui.success(`Backfill event persisted for ${workflow.name}.`);
          }
          return;
        } finally {
          await durable.close();
        }
      }
      const output =
        options.payload !== undefined
          ? { ...request, payload: options.payload, persisted: false, runRequired: true }
          : request;
      if (flags.json) {
        ui.output(JSON.stringify(output, null, 2));
      } else {
        ui.log(JSON.stringify(output, null, 2));
      }
    });

  const deployCommand = new Command('deploy');
  setCommandDescriptions(
    deployCommand,
    'Generate Compute deployment entrypoints for workflows',
    'Writes the Workflow manifest, DDL, and compute.ts adapter expected by Prisma Compute.\n' +
      'The generated app exposes webhook ingest and approval endpoints backed by the runtime.',
  );
  setCommandExamples(deployCommand, [
    'prisma-next workflow deploy --schema prisma/schema.prisma --output src/generated/workflows',
  ]);
  addWorkflowSchemaOptions(addGlobalOptions(deployCommand)).action(
    async (options: WorkflowCommandOptions) => {
      const flags = parseGlobalFlagsOrExit(options);
      const ui = createTerminalUI(flags);
      const loaded = await loadWorkflowSchema(options);
      const outDir = outputPath(options, loaded.generator);
      await generateWorkflowArtifacts(workflowArtifactWriteInput(loaded, outDir, options));
      const result = {
        outputDir: outDir,
        entrypoint: join(outDir, 'compute.ts'),
        ddl: join(outDir, 'schema.sql'),
        deployCommand: `prisma app deploy ${relative(process.cwd(), join(outDir, 'compute.ts'))}`,
      };
      if (flags.json) {
        ui.output(JSON.stringify(result, null, 2));
      } else {
        ui.success(
          `Generated Compute workflow app at ${relative(process.cwd(), result.entrypoint)}`,
        );
        ui.note(result.deployCommand, 'Deploy');
      }
    },
  );

  setCommandSeeAlso(command, [
    { verb: 'contract emit', oneLiner: 'Emit the data contract used by workflow state tables.' },
    { verb: 'db update', oneLiner: 'Apply generated workflow DDL to a development database.' },
    { verb: 'migrate', oneLiner: 'Apply schema changes before deploying workflow code.' },
  ]);

  command.addCommand(initCommand);
  command.addCommand(compileCommand);
  command.addCommand(generateCommand);
  command.addCommand(ddlCommand);
  command.addCommand(inspectCommand);
  command.addCommand(testCommand);
  command.addCommand(ingestCommand);
  command.addCommand(devCommand);
  command.addCommand(replayCommand);
  command.addCommand(backfillCommand);
  command.addCommand(deployCommand);
  return command;
}
