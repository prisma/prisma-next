import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIntegrationTestDir } from '../utils/cli-test-helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const authoringParityFixtureDir = join(__dirname, 'parity');
const authoringDiagnosticsFixtureDir = join(__dirname, 'diagnostics');

const parityRequiredFileNames = [
  'schema.prisma',
  'contract.ts',
  'packs.ts',
  'expected.contract.json',
] as const;

export interface AuthoringParityFixtureCase {
  readonly caseName: string;
  readonly caseDir: string;
  readonly schemaPath: string;
  readonly contractPath: string;
  readonly packsPath: string;
  readonly expectedContractPath: string;
}

export function listAuthoringParityFixtureCases(): readonly AuthoringParityFixtureCase[] {
  if (!existsSync(authoringParityFixtureDir)) {
    throw new Error(`Authoring parity fixture directory not found: ${authoringParityFixtureDir}`);
  }

  const entries = readdirSync(authoringParityFixtureDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return entries.map((caseName) => {
    const caseDir = join(authoringParityFixtureDir, caseName);
    const missingFiles = parityRequiredFileNames.filter(
      (fileName) => !existsSync(join(caseDir, fileName)),
    );

    if (missingFiles.length > 0) {
      throw new Error(
        `Authoring parity fixture case "${caseName}" is missing required files: ${missingFiles.join(', ')}`,
      );
    }

    return {
      caseName,
      caseDir,
      schemaPath: join(caseDir, 'schema.prisma'),
      contractPath: join(caseDir, 'contract.ts'),
      packsPath: join(caseDir, 'packs.ts'),
      expectedContractPath: join(caseDir, 'expected.contract.json'),
    };
  });
}

export function resolveAuthoringDiagnosticsFixtureSchemaPath(caseName: string): string {
  const schemaPath = join(authoringDiagnosticsFixtureDir, caseName, 'schema.prisma');
  if (!existsSync(schemaPath)) {
    throw new Error(`Authoring diagnostics fixture schema not found: ${schemaPath}`);
  }
  return schemaPath;
}

export function setupIntegrationTestDirectoryForAuthoringParityCase(caseName: string): {
  testDir: string;
  outputDir: string;
  cleanup: () => void;
  tsConfigPath: string;
  pslConfigPath: string;
  expectedContractPath: string;
} {
  const fixtureCase = listAuthoringParityFixtureCases().find(
    (candidate) => candidate.caseName === caseName,
  );
  if (!fixtureCase) {
    throw new Error(`Unknown authoring parity fixture case: ${caseName}`);
  }

  const testDir = createIntegrationTestDir();
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });

  copyFileSync(fixtureCase.contractPath, join(testDir, 'contract.ts'));
  copyFileSync(fixtureCase.schemaPath, join(testDir, 'schema.prisma'));
  copyFileSync(fixtureCase.packsPath, join(testDir, 'packs.ts'));
  copyFileSync(fixtureCase.expectedContractPath, join(testDir, 'expected.contract.json'));

  const tsConfigPath = join(testDir, 'prisma-next.config.parity-ts.ts');
  const pslConfigPath = join(testDir, 'prisma-next.config.parity-psl.ts');

  writeFileSync(
    tsConfigPath,
    `import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './contract';
import { extensionPacks } from './packs';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks,
  contract: typescriptContract(contract, 'output/contract.json'),
});
`,
    'utf-8',
  );

  writeFileSync(
    pslConfigPath,
    `import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import { extensionPacks } from './packs';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks,
  contract: prismaContract('./schema.prisma', { output: 'output/contract.json' }),
});
`,
    'utf-8',
  );

  const cleanup = () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  };

  return {
    testDir,
    outputDir,
    cleanup,
    tsConfigPath,
    pslConfigPath,
    expectedContractPath: fixtureCase.expectedContractPath,
  };
}
