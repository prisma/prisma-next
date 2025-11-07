import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { validateContract } from '@prisma-next/sql-query/schema';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';

const execFileAsync = promisify(execFile);

/**
 * Loads a contract from disk (already-emitted artifact).
 * This helper DRYs up the common pattern of loading contracts in e2e tests.
 * The contract type should be specified from the emitted contract.d.ts file.
 */
export async function loadContractFromDisk<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
>(contractJsonPath: string): Promise<TContract> {
  const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
  const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
  return validateContract<TContract>(contractJson);
}

/**
 * Emits a contract via CLI and verifies it matches the on-disk contract.json.
 * This should be used in a single test to verify contract emission correctness.
 * Returns the emitted contract for further use in the test.
 */
export async function emitAndVerifyContract(
  cliPath: string,
  contractTsPath: string,
  adapterPath: string,
  outputDir: string,
  expectedContractJsonPath: string,
): Promise<SqlContract<SqlStorage>> {
  await execFileAsync('node', [
    cliPath,
    'emit',
    '--contract',
    contractTsPath,
    '--out',
    outputDir,
    '--adapter',
    adapterPath,
  ]);

  const emittedContractJsonPath = join(outputDir, 'contract.json');
  const emittedContractContent = await readFile(emittedContractJsonPath, 'utf-8');
  const emittedContract = JSON.parse(emittedContractContent) as Record<string, unknown>;

  const expectedContractContent = await readFile(expectedContractJsonPath, 'utf-8');
  const expectedContract = JSON.parse(expectedContractContent) as Record<string, unknown>;

  if (JSON.stringify(emittedContract) !== JSON.stringify(expectedContract)) {
    throw new Error(
      `Emitted contract does not match expected contract on disk.\nExpected: ${expectedContractJsonPath}\nEmitted: ${emittedContractJsonPath}`,
    );
  }

  return validateContract<SqlContract<SqlStorage>>(emittedContract);
}

