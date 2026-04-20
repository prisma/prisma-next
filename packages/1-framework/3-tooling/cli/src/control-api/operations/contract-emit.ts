import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { Contract } from '@prisma-next/contract/types';
import { emit } from '@prisma-next/emitter';
import { createControlStack } from '@prisma-next/framework-components/control';
import { abortable } from '@prisma-next/utils/abortable';
import { ifDefined } from '@prisma-next/utils/defined';
import { basename, dirname, isAbsolute, join, resolve } from 'pathe';
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
  committedGeneration: number;
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
    committedGeneration: 0,
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
}): Promise<void> {
  await queueEmitWrite(outputJsonPath, async (state) => {
    signal.throwIfAborted();

    if (generation < state.nextGeneration) {
      return;
    }

    const tempJsonPath = createTempArtifactPath(outputJsonPath, generation, 'next');
    const tempDtsPath = createTempArtifactPath(outputDtsPath, generation, 'next');
    let cleanupJsonTemp = true;
    let cleanupDtsTemp = true;

    try {
      await writeFile(tempJsonPath, contractJson, 'utf-8');
      await writeFile(tempDtsPath, contractDts, 'utf-8');

      signal.throwIfAborted();

      if (generation < state.nextGeneration) {
        return;
      }

      const previousDts = await readExistingArtifact(outputDtsPath);
      const previousJson = await readExistingArtifact(outputJsonPath);
      let replacedDts = false;
      let replacedJson = false;

      try {
        await rename(tempDtsPath, outputDtsPath);
        cleanupDtsTemp = false;
        replacedDts = true;

        await rename(tempJsonPath, outputJsonPath);
        cleanupJsonTemp = false;
        replacedJson = true;
      } catch (error) {
        await Promise.allSettled([
          replacedDts ? restoreArtifact(outputDtsPath, previousDts, generation) : Promise.resolve(),
          replacedJson
            ? restoreArtifact(outputJsonPath, previousJson, generation)
            : Promise.resolve(),
        ]);
        throw error;
      }

      state.committedGeneration = generation;
    } finally {
      await Promise.allSettled([
        cleanupJsonTemp ? rm(tempJsonPath, { force: true }) : Promise.resolve(),
        cleanupDtsTemp ? rm(tempDtsPath, { force: true }) : Promise.resolve(),
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
  if (!contractConfig.output.endsWith('.json')) {
    throw errorContractConfigMissing({
      why: 'Contract config output path must end with .json (e.g., "src/prisma/contract.json")',
    });
  }

  // Validate source exists and is callable
  if (typeof contractConfig.source !== 'function') {
    throw errorContractConfigMissing({
      why: 'Contract config must include a valid source provider function',
    });
  }

  // Normalize configPath and resolve artifact paths relative to config file directory
  const normalizedConfigPath = resolve(configPath);
  const configDir = dirname(normalizedConfigPath);
  const outputJsonPath = isAbsolute(contractConfig.output)
    ? contractConfig.output
    : join(configDir, contractConfig.output);
  // Colocate .d.ts with .json (contract.json → contract.d.ts)
  const outputDtsPath = `${outputJsonPath.slice(0, -5)}.d.ts`;
  const generation = issueEmitGeneration(outputJsonPath);

  const stack = createControlStack(config);

  const sourceContext = {
    composedExtensionPacks: stack.extensionPacks.map((p) => p.id),
    scalarTypeDescriptors: stack.scalarTypeDescriptors,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
  };

  let providerResult: Awaited<ReturnType<typeof contractConfig.source>>;
  try {
    providerResult = await unlessAborted(contractConfig.source(sourceContext));
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      throw error;
    }
    throw errorRuntime('Failed to resolve contract source', {
      why: error instanceof Error ? error.message : String(error),
      fix: 'Ensure contract.source resolves to ok(Contract) or returns structured diagnostics.',
    });
  }

  if (!isRecord(providerResult) || typeof providerResult.ok !== 'boolean') {
    throw errorRuntime('Failed to resolve contract source', {
      why: 'Contract source provider returned malformed result shape.',
      fix: 'Ensure contract.source resolves to ok(Contract) or notOk({ summary, diagnostics }).',
    });
  }

  if (providerResult.ok && !('value' in providerResult)) {
    throw errorRuntime('Failed to resolve contract source', {
      why: 'Contract source provider returned malformed success result: missing value.',
      fix: 'Ensure contract.source success payload is ok(Contract).',
    });
  }

  if (!providerResult.ok && !isProviderFailureLike(providerResult.failure)) {
    throw errorRuntime('Failed to resolve contract source', {
      why: 'Contract source provider returned malformed failure result: expected summary and diagnostics.',
      fix: 'Ensure contract.source failure payload is notOk({ summary, diagnostics, meta? }).',
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
  const emitResult = await unlessAborted(emit(enrichedIR, stack, config.family.emission));

  // Create directory if needed and write files (both colocated)
  await unlessAborted(mkdir(dirname(outputJsonPath), { recursive: true }));
  await writeContractArtifacts({
    outputJsonPath,
    outputDtsPath,
    generation,
    signal,
    contractJson: emitResult.contractJson,
    contractDts: emitResult.contractDts,
  });

  // Validate that contract.d.ts type imports are resolvable
  const { validateContractDeps } = await import('../../utils/validate-contract-deps');
  const depsValidation = validateContractDeps(emitResult.contractDts, dirname(outputDtsPath));
  if (depsValidation.warning) {
    process.stderr.write(`\n⚠ ${depsValidation.warning}\n`);
  }

  return {
    storageHash: emitResult.storageHash,
    ...ifDefined('executionHash', emitResult.executionHash),
    profileHash: emitResult.profileHash,
    files: {
      json: outputJsonPath,
      dts: outputDtsPath,
    },
  };
}
