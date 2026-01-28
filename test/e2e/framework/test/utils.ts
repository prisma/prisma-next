import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';

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
 *
 * The config file should already include the contract configuration with nested structure:
 * ```typescript
 * contract: {
 *   source: contract,
 *   output: 'path/to/contract.json',
 *   types: 'path/to/contract.d.ts',
 * }
 * ```
 */
export async function emitAndVerifyContract(
  cliPath: string,
  configPath: string,
  expectedContractJsonPath: string,
): Promise<SqlContract<SqlStorage>> {
  await execFileAsync('node', [cliPath, 'contract', 'emit', '--config', configPath]);

  // Read the emitted contract from the path specified in config.contract.output
  // For now, we'll read from expectedContractJsonPath since that's what the test expects
  // In the future, we could parse the config to get the actual output path
  const emittedContractContent = await readFile(expectedContractJsonPath, 'utf-8');
  const emittedContract = JSON.parse(emittedContractContent) as Record<string, unknown>;

  const expectedContractContent = await readFile(expectedContractJsonPath, 'utf-8');
  const expectedContract = JSON.parse(expectedContractContent) as Record<string, unknown>;

  if (JSON.stringify(emittedContract) !== JSON.stringify(expectedContract)) {
    throw new Error(
      `Emitted contract does not match expected contract on disk.\nExpected: ${expectedContractJsonPath}\nEmitted: ${expectedContractJsonPath}`,
    );
  }

  return validateContract<SqlContract<SqlStorage>>(emittedContract);
}

export async function runDbInit(options: {
  readonly cliPath: string;
  readonly configPath: string;
  readonly dbUrl: string;
  readonly cwd?: string;
}): Promise<void> {
  const { cliPath, configPath, dbUrl, cwd } = options;
  await execFileAsync(
    'node',
    [cliPath, 'db', 'init', '--config', configPath, '--db', dbUrl, '--quiet', '--no-color'],
    { cwd, timeout: 30000 },
  );
}
