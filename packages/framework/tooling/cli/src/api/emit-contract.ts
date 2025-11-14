import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import type { TargetFamilyHook, TypesImportSpec } from '@prisma-next/contract/types';
import { emit } from '@prisma-next/emitter';
import type { OperationRegistry } from '@prisma-next/operations';

export interface LoggerLike {
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

export interface EmitContractOptions {
  readonly contractIR: ContractIR;
  readonly outputJsonPath: string;
  readonly outputDtsPath: string;
  readonly targetFamily: TargetFamilyHook;
  readonly operationRegistry: OperationRegistry;
  readonly codecTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly operationTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds: ReadonlyArray<string>;
  readonly logger?: LoggerLike;
}

export interface EmitContractResult {
  readonly coreHash: string;
  readonly profileHash: string;
  readonly outDir: string;
  readonly files: {
    readonly json: string;
    readonly dts: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

/**
 * Programmatic API for emitting contracts.
 * Accepts resolved contract IR, output paths, and assembly data.
 * The caller is responsible for loading the contract and resolving paths.
 *
 * @param options - Options for contract emission
 * @returns Result with hashes, file paths, and timings
 * @throws Error if contract emission fails
 */
export async function emitContract(options: EmitContractOptions): Promise<EmitContractResult> {
  const startTime = Date.now();

  try {
    const {
      contractIR,
      outputJsonPath,
      outputDtsPath,
      targetFamily,
      operationRegistry,
      codecTypeImports,
      operationTypeImports,
      extensionIds,
    } = options;

    // Resolve absolute paths
    const contractJsonPath = resolve(outputJsonPath);
    const contractDtsPath = resolve(outputDtsPath);

    const result = await emit(
      contractIR,
      {
        outputDir: dirname(contractJsonPath),
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      },
      targetFamily,
    );

    // Create directories if needed
    mkdirSync(dirname(contractJsonPath), { recursive: true });
    mkdirSync(dirname(contractDtsPath), { recursive: true });

    // Write the results
    writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
    writeFileSync(contractDtsPath, result.contractDts, 'utf-8');

    const totalTime = Date.now() - startTime;

    return {
      coreHash: result.coreHash,
      profileHash: result.profileHash,
      outDir: dirname(contractJsonPath),
      files: {
        json: contractJsonPath,
        dts: contractDtsPath,
      },
      timings: {
        total: totalTime,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to emit contract: ${String(error)}`);
  }
}
