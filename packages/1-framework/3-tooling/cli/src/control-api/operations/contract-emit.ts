import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { Contract } from '@prisma-next/contract/types';
import { emit, getEmittedArtifactPaths } from '@prisma-next/emitter';
import { createControlStack } from '@prisma-next/framework-components/control';
import { abortable } from '@prisma-next/utils/abortable';
import { ifDefined } from '@prisma-next/utils/defined';
import { basename, dirname, join } from 'pathe';
import { loadConfig } from '../../config-loader';
import { errorContractConfigMissing, errorRuntime } from '../../utils/cli-errors';
import { assertFrameworkComponentsCompatible } from '../../utils/framework-components';
import { enrichContract } from '../contract-enrichment';
import type { ContractEmitOptions, ContractEmitResult } from '../types';

interface ProviderFailureLike {
  readonly summary: string;
  readonly diagnostics: readonly unknown[];
  readonly meta?: unknown;
}

interface EmitWriteTargetState {
  nextGeneration: number;
  queue: Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && typeof error['name'] === 'string' && error['name'] === 'AbortError';
}

function isProviderFailureLike(value: unknown): value is ProviderFailureLike {
  return (
    isRecord(value) && typeof value['summary'] === 'string' && Array.isArray(value['diagnostics'])
  );
}

const emitWriteTargets = new Map<string, EmitWriteTargetState>();

function getEmitWriteTargetState(outputJsonPath: string): EmitWriteTargetState {
  const existing = emitWriteTargets.get(outputJsonPath);
  if (existing) {
    return existing;
  }

  const created: EmitWriteTargetState = {
    nextGeneration: 0,
    queue: Promise.resolve(),
  };
  emitWriteTargets.set(outputJsonPath, created);
  return created;
}

function issueEmitGeneration(outputJsonPath: string): number {
  const state = getEmitWriteTargetState(outputJsonPath);
  state.nextGeneration += 1;
  return state.nextGeneration;
}

function queueEmitWrite<T>(
  outputJsonPath: string,
  action: (state: EmitWriteTargetState) => Promise<T>,
): Promise<T> {
  const state = getEmitWriteTargetState(outputJsonPath);
  const run = state.queue.then(
    () => action(state),
    () => action(state),
  );
  state.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function createTempArtifactPath(path: string, generation: number, phase: string): string {
  return join(dirname(path), `.${basename(path)}.${process.pid}.${generation}.${phase}.tmp`);
}

async function readExistingArtifact(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    if (isRecord(error) && error['code'] === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function restoreArtifact(
  path: string,
  content: string | undefined,
  generation: number,
): Promise<void> {
  if (content === undefined) {
    await rm(path, { force: true });
    return;
  }

  const restorePath = createTempArtifactPath(path, generation, 'rollback');
  await writeFile(restorePath, content, 'utf-8');
  try {
    await rename(restorePath, path);
  } finally {
    await rm(restorePath, { force: true });
  }
}

interface PublishEntry {
  readonly tempPath: string;
  readonly outputPath: string;
  readonly previous: string | undefined;
}

async function publishPairWithRollback(
  entries: readonly PublishEntry[],
  generation: number,
): Promise<void> {
  const replaced: PublishEntry[] = [];
  try {
    for (const entry of entries) {
      await rename(entry.tempPath, entry.outputPath);
      replaced.push(entry);
    }
  } catch (error) {
    await Promise.allSettled(
      replaced.map((entry) => restoreArtifact(entry.outputPath, entry.previous, generation)),
    );
    throw error;
  }
}

async function writeContractArtifacts({
  outputJsonPath,
  outputDtsPath,
  generation,
  signal,
  contractJson,
  contractDts,
}: {
  readonly outputJsonPath: string;
  readonly outputDtsPath: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly contractJson: string;
  readonly contractDts: string;
}): Promise<'written' | 'superseded'> {
  return await queueEmitWrite(outputJsonPath, async (state) => {
    signal.throwIfAborted();

    if (generation < state.nextGeneration) {
      return 'superseded';
    }

    const tempJsonPath = createTempArtifactPath(outputJsonPath, generation, 'next');
    const tempDtsPath = createTempArtifactPath(outputDtsPath, generation, 'next');

    try {
      await writeFile(tempJsonPath, contractJson, 'utf-8');
      await writeFile(tempDtsPath, contractDts, 'utf-8');

      signal.throwIfAborted();

      if (generation < state.nextGeneration) {
        return 'superseded';
      }

      const previousJson = await readExistingArtifact(outputJsonPath);
      const previousDts = await readExistingArtifact(outputDtsPath);

      await publishPairWithRollback(
        [
          { tempPath: tempDtsPath, outputPath: outputDtsPath, previous: previousDts },
          { tempPath: tempJsonPath, outputPath: outputJsonPath, previous: previousJson },
        ],
        generation,
      );
      return 'written';
    } finally {
      await Promise.allSettled([
        rm(tempJsonPath, { force: true }),
        rm(tempDtsPath, { force: true }),
      ]);
    }
  });
}

/**
 * Executes the contract emit operation.
 *
 * This is an offline operation that:
 * 1. Loads the Prisma Next config from the specified path
 * 2. Resolves the contract source from config
 * 3. Creates a control plane stack and family instance
 * 4. Emits contract artifacts (JSON and DTS)
 * 5. Writes files to the paths specified in config
 *
 * Supports AbortSignal for cancellation, enabling "last change wins" behavior.
 *
 * @param options - Options including configPath and optional signal
 * @returns File paths and hashes of emitted artifacts
 * @throws If config loading fails, contract is invalid, or file I/O fails
 * @throws signal.reason if cancelled via AbortSignal (typically DOMException with name 'AbortError')
 */
export async function executeContractEmit(
  options: ContractEmitOptions,
): Promise<ContractEmitResult> {
  const { configPath, signal = new AbortController().signal } = options;
  const unlessAborted = abortable(signal);

  // Load config using the existing config loader
  const config = await unlessAborted(loadConfig(configPath));

  // Validate contract config is present
  if (!config.contract) {
    throw errorContractConfigMissing({
      why: 'Config.contract is required for emit. Define it in your config: contract: { source: ..., output: ... }',
    });
  }

  const contractConfig = config.contract;

  // Validate output path is present and ends with .json
  if (!contractConfig.output) {
    throw errorContractConfigMissing({
      why: 'Contract config must have output path. This should not happen if defineConfig() was used.',
    });
  }

  // Validate source exists and is callable
  if (typeof contractConfig.source?.load !== 'function') {
    throw errorContractConfigMissing({
      why: 'Contract config must include a valid source provider object',
    });
  }

  let outputPaths: ReturnType<typeof getEmittedArtifactPaths>;
  try {
    outputPaths = getEmittedArtifactPaths(contractConfig.output);
  } catch (error) {
    throw errorContractConfigMissing({
      why: error instanceof Error ? error.message : String(error),
    });
  }
  const { jsonPath: outputJsonPath, dtsPath: outputDtsPath } = outputPaths;
  const generation = issueEmitGeneration(outputJsonPath);

  const stack = createControlStack(config);

  const sourceContext = {
    composedExtensionPacks: stack.extensionPacks.map((p) => p.id),
    scalarTypeDescriptors: stack.scalarTypeDescriptors,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: contractConfig.source.inputs ?? [],
  };

  let providerResult: Awaited<ReturnType<typeof contractConfig.source.load>>;
  try {
    providerResult = await unlessAborted(contractConfig.source.load(sourceContext));
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      throw error;
    }
    throw errorRuntime('Failed to resolve contract source', {
      why: error instanceof Error ? error.message : String(error),
      fix: 'Ensure contract.source.load resolves to ok(Contract) or returns structured diagnostics.',
    });
  }

  if (!isRecord(providerResult) || typeof providerResult.ok !== 'boolean') {
    throw errorRuntime('Failed to resolve contract source', {
      why: 'Contract source provider returned malformed result shape.',
      fix: 'Ensure contract.source.load resolves to ok(Contract) or notOk({ summary, diagnostics }).',
    });
  }

  if (providerResult.ok && !('value' in providerResult)) {
    throw errorRuntime('Failed to resolve contract source', {
      why: 'Contract source provider returned malformed success result: missing value.',
      fix: 'Ensure contract.source.load success payload is ok(Contract).',
    });
  }

  if (!providerResult.ok && !isProviderFailureLike(providerResult.failure)) {
    throw errorRuntime('Failed to resolve contract source', {
      why: 'Contract source provider returned malformed failure result: expected summary and diagnostics.',
      fix: 'Ensure contract.source.load failure payload is notOk({ summary, diagnostics, meta? }).',
    });
  }

  if (!providerResult.ok) {
    throw errorRuntime('Failed to resolve contract source', {
      why: providerResult.failure.summary,
      fix: 'Fix contract source diagnostics and return ok(Contract).',
      meta: {
        diagnostics: providerResult.failure.diagnostics,
        ...ifDefined('providerMeta', providerResult.failure.meta),
      },
    });
  }

  const familyInstance = config.family.create(stack);

  const rawComponents = [config.target, config.adapter, ...(config.extensionPacks ?? [])];
  const frameworkComponents = assertFrameworkComponentsCompatible(
    config.family.familyId,
    config.target.targetId,
    rawComponents,
  );
  const enrichedIR = enrichContract(providerResult.value as Contract, frameworkComponents);

  familyInstance.validateContract(enrichedIR);
  const emitResult = await unlessAborted(
    emit(enrichedIR, stack, config.family.emission, {
      outputJsonPath,
    }),
  );

  await unlessAborted(mkdir(dirname(outputJsonPath), { recursive: true }));
  const publication = await writeContractArtifacts({
    outputJsonPath,
    outputDtsPath,
    generation,
    signal,
    contractJson: emitResult.contractJson,
    contractDts: emitResult.contractDts,
  });

  const { validateContractDeps } = await import('../../utils/validate-contract-deps');
  const depsValidation = validateContractDeps(emitResult.contractDts, dirname(outputDtsPath));
  if (depsValidation.warning) {
    process.stderr.write(`\n⚠ ${depsValidation.warning}\n`);
  }

  return {
    storageHash: emitResult.storageHash,
    ...ifDefined('executionHash', emitResult.executionHash),
    profileHash: emitResult.profileHash,
    publication,
    files: {
      json: outputJsonPath,
      dts: outputDtsPath,
    },
  };
}
