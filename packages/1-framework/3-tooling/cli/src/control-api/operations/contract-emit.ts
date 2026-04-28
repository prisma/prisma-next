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
import { validateContractDeps } from '../../utils/validate-contract-deps';
import { enrichContract } from '../contract-enrichment';
import type {
  ContractEmitOptions,
  ContractEmitResult,
  ControlActionName,
  OnControlProgress,
} from '../types';

const EMIT_ACTION: ControlActionName = 'emit';

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

function startSpan(onProgress: OnControlProgress | undefined, spanId: string, label: string): void {
  onProgress?.({ action: EMIT_ACTION, kind: 'spanStart', spanId, label });
}

function endSpan(
  onProgress: OnControlProgress | undefined,
  spanId: string,
  outcome: 'ok' | 'error',
): void {
  onProgress?.({ action: EMIT_ACTION, kind: 'spanEnd', spanId, outcome });
}

/**
 * Canonical contract emit operation.
 *
 * This is the SINGLE publication path used by both the CLI command
 * (`prisma-next contract emit`) and the Vite plugin
 * (`@prisma-next/vite-plugin-contract-emit`). New callers must go through this
 * function rather than re-implementing load → emit → publish.
 *
 * Publication is serialized per output JSON path. Each emit stages temp files,
 * renames `contract.d.ts` before `contract.json`, and attempts to restore the
 * previous pair if publication fails after either path has been replaced.
 *
 * If a newer generation has already claimed the same output path by the time
 * this request reaches publication, the operation returns successfully with
 * `publication: 'superseded'` and leaves the on-disk artifacts unchanged.
 * Callers must treat that outcome as a successful no-op (the bytes on disk are
 * at least as fresh as this request's bytes), not as an error.
 *
 * @throws {CliStructuredError} on config/source/validation problems
 * @throws {DOMException} `AbortError` if cancelled via `signal`
 */
export async function executeContractEmit(
  options: ContractEmitOptions,
): Promise<ContractEmitResult> {
  const { configPath, signal = new AbortController().signal, onProgress } = options;
  const unlessAborted = abortable(signal);

  const config = await unlessAborted(loadConfig(configPath));

  if (!config.contract) {
    throw errorContractConfigMissing({
      why: 'Config.contract is required for emit. Define it in your config: contract: { source: ..., output: ... }',
    });
  }

  const contractConfig = config.contract;

  if (!contractConfig.output) {
    throw errorContractConfigMissing({
      why: 'Contract config must have output path. This should not happen if defineConfig() was used.',
    });
  }

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

  startSpan(onProgress, 'resolveSource', 'Resolving contract source...');
  let providerResult: Awaited<ReturnType<typeof contractConfig.source.load>>;
  try {
    providerResult = await unlessAborted(contractConfig.source.load(sourceContext));
  } catch (error) {
    endSpan(onProgress, 'resolveSource', 'error');
    if (signal.aborted || isAbortError(error)) {
      throw error;
    }
    throw errorRuntime('Failed to resolve contract source', {
      why: error instanceof Error ? error.message : String(error),
      fix: 'Ensure contract.source.load resolves to ok(Contract) or returns structured diagnostics.',
    });
  }

  if (!isRecord(providerResult) || typeof providerResult.ok !== 'boolean') {
    endSpan(onProgress, 'resolveSource', 'error');
    throw errorRuntime('Failed to resolve contract source', {
      why: 'Contract source provider returned malformed result shape.',
      fix: 'Ensure contract.source.load resolves to ok(Contract) or notOk({ summary, diagnostics }).',
    });
  }

  if (providerResult.ok && !('value' in providerResult)) {
    endSpan(onProgress, 'resolveSource', 'error');
    throw errorRuntime('Failed to resolve contract source', {
      why: 'Contract source provider returned malformed success result: missing value.',
      fix: 'Ensure contract.source.load success payload is ok(Contract).',
    });
  }

  if (!providerResult.ok && !isProviderFailureLike(providerResult.failure)) {
    endSpan(onProgress, 'resolveSource', 'error');
    throw errorRuntime('Failed to resolve contract source', {
      why: 'Contract source provider returned malformed failure result: expected summary and diagnostics.',
      fix: 'Ensure contract.source.load failure payload is notOk({ summary, diagnostics, meta? }).',
    });
  }

  if (!providerResult.ok) {
    endSpan(onProgress, 'resolveSource', 'error');
    throw errorRuntime('Failed to resolve contract source', {
      why: providerResult.failure.summary,
      fix: 'Fix contract source diagnostics and return ok(Contract).',
      meta: {
        diagnostics: providerResult.failure.diagnostics,
        ...ifDefined('providerMeta', providerResult.failure.meta),
      },
    });
  }
  endSpan(onProgress, 'resolveSource', 'ok');

  startSpan(onProgress, 'emit', 'Emitting contract...');
  let emitResult: Awaited<ReturnType<typeof emit>>;
  try {
    const familyInstance = config.family.create(stack);
    const rawComponents = [config.target, config.adapter, ...(config.extensionPacks ?? [])];
    const frameworkComponents = assertFrameworkComponentsCompatible(
      config.family.familyId,
      config.target.targetId,
      rawComponents,
    );
    const enrichedIR = enrichContract(providerResult.value as Contract, frameworkComponents);
    familyInstance.validateContract(enrichedIR);
    emitResult = await unlessAborted(
      emit(enrichedIR, stack, config.family.emission, { outputJsonPath }),
    );
  } catch (error) {
    endSpan(onProgress, 'emit', 'error');
    throw error;
  }
  endSpan(onProgress, 'emit', 'ok');

  await unlessAborted(mkdir(dirname(outputJsonPath), { recursive: true }));
  const publication = await publishContractArtifactPairSerialized({
    outputJsonPath,
    outputDtsPath,
    generation,
    signal,
    contractJson: emitResult.contractJson,
    contractDts: emitResult.contractDts,
  });

  const validationWarning =
    publication === 'written'
      ? validateContractDeps(emitResult.contractDts, dirname(outputDtsPath)).warning
      : undefined;

  return {
    storageHash: emitResult.storageHash,
    ...ifDefined('executionHash', emitResult.executionHash),
    profileHash: emitResult.profileHash,
    publication,
    files: {
      json: outputJsonPath,
      dts: outputDtsPath,
    },
    ...ifDefined('validationWarning', validationWarning),
  };
}
