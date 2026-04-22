import { mkdir } from 'node:fs/promises';
import type { Contract } from '@prisma-next/contract/types';
import { emit, getEmittedArtifactPaths } from '@prisma-next/emitter';
import { createControlStack } from '@prisma-next/framework-components/control';
import { abortable } from '@prisma-next/utils/abortable';
import { ifDefined } from '@prisma-next/utils/defined';
import { dirname } from 'pathe';
import { loadConfig } from '../../config-loader';
import { errorContractConfigMissing, errorRuntime } from '../../utils/cli-errors';
import { assertFrameworkComponentsCompatible } from '../../utils/framework-components';
import {
  issueContractArtifactGeneration,
  publishContractArtifactPairSerialized,
} from '../../utils/publish-contract-artifact-pair-serialized';
import { enrichContract } from '../contract-enrichment';
import type { ContractEmitOptions, ContractEmitResult } from '../types';

interface ProviderFailureLike {
  readonly summary: string;
  readonly diagnostics: readonly unknown[];
  readonly meta?: unknown;
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

/**
 * Executes the contract emit operation.
 *
 * This is an offline operation that:
 * 1. Loads the Prisma Next config from the specified path
 * 2. Resolves the contract source from config
 * 3. Creates a control plane stack and family instance
 * 4. Emits contract artifacts (JSON and DTS)
 * 5. Publishes staged artifacts to the configured output paths
 *
 * Publication is serialized per output JSON path. Each emit stages temp files,
 * renames `contract.d.ts` before `contract.json`, and restores the previous
 * pair if publication fails after either path has been replaced.
 *
 * If a newer generation has already claimed the same output path by the time
 * this request reaches publication, the operation returns successfully with
 * `publication: 'superseded'` and leaves the on-disk artifacts unchanged.
 *
 * Callers that can overlap emits for the same output should cancel older work
 * before starting newer work. The queue prevents stale overwrites, but a newer
 * failed emit can still supersede an older successful emit that arrives later.
 *
 * @param options - Options including configPath and optional signal
 * @returns File paths and hashes for the emitted bytes, plus whether they were published
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
  const generation = issueContractArtifactGeneration(outputJsonPath);

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
  const publication = await publishContractArtifactPairSerialized({
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
