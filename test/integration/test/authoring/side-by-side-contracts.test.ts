import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoAdapter from '@prisma-next/adapter-mongo/control';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type {
  ContractSourceContext,
  ContractSourceEnvironment,
} from '@prisma-next/cli/config-types';
import { enrichContract } from '@prisma-next/cli/control-api';
import type { Contract } from '@prisma-next/contract/types';
import { emit } from '@prisma-next/emitter';
import { mongoFamilyDescriptor, mongoTargetDescriptor } from '@prisma-next/family-mongo/control';
import sql from '@prisma-next/family-sql/control';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import { mongoContract } from '@prisma-next/mongo-contract-psl/provider';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract as validateSqlContract } from '@prisma-next/sql-contract/validate';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import { timeouts } from '@prisma-next/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureRootDir = join(__dirname, 'side-by-side');
const shouldUpdateExpected = process.env['UPDATE_SIDE_BY_SIDE_CONTRACTS'] === '1';

const sqlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
});

const mongoStack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
});

const sqlSourceContext: ContractSourceContext = {
  composedExtensionPacks: [],
  scalarTypeDescriptors: sqlStack.scalarTypeDescriptors,
  authoringContributions: sqlStack.authoringContributions,
  codecLookup: sqlStack.codecLookup,
  controlMutationDefaults: sqlStack.controlMutationDefaults,
};

const mongoSourceContext: ContractSourceContext = {
  composedExtensionPacks: [],
  scalarTypeDescriptors: mongoStack.scalarTypeDescriptors,
  authoringContributions: mongoStack.authoringContributions,
  codecLookup: mongoStack.codecLookup,
  controlMutationDefaults: mongoStack.controlMutationDefaults,
};

const sourceEnvironment: ContractSourceEnvironment = {
  configDir: fixtureRootDir,
};

type FixtureName = 'postgres' | 'mongo';

interface FixtureCase {
  readonly name: FixtureName;
  readonly caseDir: string;
  readonly contractTsPath: string;
  readonly contractPslPath: string;
  readonly expectedContractJsonPath: string;
}

interface LoadedFixture {
  readonly tsContract: Contract;
}

const fixtureNames = ['postgres', 'mongo'] as const satisfies readonly FixtureName[];

const fixtureCases: readonly FixtureCase[] = fixtureNames.map((name): FixtureCase => {
  const caseDir = join(fixtureRootDir, name);
  return {
    name,
    caseDir,
    contractTsPath: join(caseDir, 'contract.ts'),
    contractPslPath: join(caseDir, 'contract.prisma'),
    expectedContractJsonPath: join(caseDir, 'contract.json'),
  };
});

function parseContractJson(contractJson: string): Record<string, unknown> {
  return JSON.parse(contractJson) as Record<string, unknown>;
}

async function loadFixture(fixtureCase: FixtureCase): Promise<LoadedFixture> {
  const contractModule = (await import(pathToFileURL(fixtureCase.contractTsPath).href)) as {
    readonly contract: Contract;
  };

  return {
    tsContract: contractModule.contract,
  };
}

function readExpectedContractJson(fixtureCase: FixtureCase): string {
  if (!existsSync(fixtureCase.expectedContractJsonPath)) {
    if (shouldUpdateExpected) {
      return '';
    }
    throw new Error(
      `Expected contract snapshot not found: ${fixtureCase.expectedContractJsonPath}. ` +
        'Run with UPDATE_SIDE_BY_SIDE_CONTRACTS=1 to create it.',
    );
  }

  return readFileSync(fixtureCase.expectedContractJsonPath, 'utf-8').trim();
}

function writeExpectedContractJson(fixtureCase: FixtureCase, contractJson: string): void {
  writeFileSync(fixtureCase.expectedContractJsonPath, `${contractJson}\n`, 'utf-8');
}

function validateEmittedSqlContract(contractJson: Record<string, unknown>) {
  return validateSqlContract<Contract<SqlStorage>>(contractJson, emptyCodecLookup);
}

function validateEmittedMongoContract(contractJson: Record<string, unknown>) {
  return validateMongoContract<MongoContract>(contractJson);
}

describe('side-by-side contract examples', () => {
  it('discovers Postgres and Mongo fixtures', () => {
    expect(fixtureCases).toHaveLength(2);
    expect(fixtureCases.map((fixtureCase) => fixtureCase.name)).toEqual(['postgres', 'mongo']);
  });

  it('loads the side-by-side fixture files from disk', async () => {
    const fixtures = await Promise.all(fixtureCases.map(loadFixture));

    expect(fixtures).toHaveLength(2);
  });

  it(
    'validates and emits the Postgres side-by-side contract from TS and PSL',
    async () => {
      const fixtureCase = fixtureCases.find((candidate) => candidate.name === 'postgres');
      if (!fixtureCase) {
        throw new Error('Postgres fixture not found');
      }

      const fixture = await loadFixture(fixtureCase);
      const provider = prismaContract(fixtureCase.contractPslPath, {
        target: postgres,
      });

      const providerResult = await provider.source.load(sqlSourceContext, sourceEnvironment);
      expect(providerResult.ok).toBe(true);
      if (!providerResult.ok) {
        throw new Error(providerResult.failure.summary);
      }

      const familyInstance = sql.create(sqlStack);
      const frameworkComponents = [postgres, postgresAdapter];

      const normalizedTs = familyInstance.validateContract(
        enrichContract(fixture.tsContract, frameworkComponents),
      );
      const normalizedPsl = familyInstance.validateContract(
        enrichContract(providerResult.value, frameworkComponents),
      );

      expect(normalizedTs).toEqual(normalizedPsl);

      const emittedTs = await emit(normalizedTs, sqlStack, sql.emission);
      const emittedPsl = await emit(normalizedPsl, sqlStack, sql.emission);

      expect(emittedTs.contractJson).toBe(emittedPsl.contractJson);

      const emittedContractJson = parseContractJson(emittedTs.contractJson);
      const validatedContract = validateEmittedSqlContract(emittedContractJson);

      expect(validatedContract.roots).toEqual({
        posts: 'Post',
        users: 'User',
      });
      expect(validatedContract.models['User']?.relations['posts']).toMatchObject({
        cardinality: '1:N',
        to: 'Post',
      });
      expect(validatedContract.models['Post']?.relations['author']).toMatchObject({
        cardinality: 'N:1',
        to: 'User',
        on: {
          localFields: ['authorId'],
          targetFields: ['id'],
        },
      });

      if (shouldUpdateExpected) {
        writeExpectedContractJson(fixtureCase, emittedTs.contractJson);
      }

      expect(emittedTs.contractJson).toBe(readExpectedContractJson(fixtureCase));
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'validates and emits the Mongo side-by-side contract from TS and PSL',
    async () => {
      const fixtureCase = fixtureCases.find((candidate) => candidate.name === 'mongo');
      if (!fixtureCase) {
        throw new Error('Mongo fixture not found');
      }

      const fixture = await loadFixture(fixtureCase);
      const provider = mongoContract(fixtureCase.contractPslPath);
      const providerResult = await provider.source.load(mongoSourceContext, sourceEnvironment);
      expect(providerResult.ok).toBe(true);
      if (!providerResult.ok) {
        throw new Error(providerResult.failure.summary);
      }

      const familyInstance = mongoFamilyDescriptor.create(mongoStack);
      const frameworkComponents = [mongoTargetDescriptor, mongoAdapter];

      const normalizedTs = familyInstance.validateContract(
        enrichContract(fixture.tsContract, frameworkComponents),
      );
      const normalizedPsl = familyInstance.validateContract(
        enrichContract(providerResult.value, frameworkComponents),
      );

      const stripValidatorFields = (contract: typeof normalizedTs) => {
        const storage = contract.storage as unknown as Record<string, unknown>;
        const collections = storage['collections'] as Record<string, Record<string, unknown>>;
        const stripped: Record<string, unknown> = {};
        for (const [name, coll] of Object.entries(collections)) {
          const { validator: _, ...rest } = coll;
          stripped[name] = rest;
        }
        const { storageHash: _sh, ...restStorage } = storage;
        return { ...contract, storage: { ...restStorage, collections: stripped } };
      };
      expect(stripValidatorFields(normalizedTs)).toEqual(stripValidatorFields(normalizedPsl));

      const emittedTs = await emit(normalizedTs, mongoStack, mongoFamilyDescriptor.emission);
      const emittedPsl = await emit(normalizedPsl, mongoStack, mongoFamilyDescriptor.emission);

      const stripForComparison = (json: string) => {
        const parsed = JSON.parse(json) as Record<string, unknown>;
        const storage = parsed['storage'] as Record<string, unknown>;
        const collections = storage['collections'] as Record<string, Record<string, unknown>>;
        const strippedCollections: Record<string, unknown> = {};
        for (const [name, coll] of Object.entries(collections)) {
          const { validator: _, ...rest } = coll;
          strippedCollections[name] = rest;
        }
        const { storageHash: _sh, ...restStorage } = storage;
        return { ...parsed, storage: { ...restStorage, collections: strippedCollections } };
      };
      expect(stripForComparison(emittedTs.contractJson)).toEqual(
        stripForComparison(emittedPsl.contractJson),
      );

      const emittedContractJson = parseContractJson(emittedPsl.contractJson);
      const validatedContract = validateEmittedMongoContract(emittedContractJson);

      expect(validatedContract.contract.roots).toEqual({
        posts: 'Post',
        users: 'User',
      });
      expect(validatedContract.contract.models['User']?.relations['posts']).toMatchObject({
        cardinality: '1:N',
        to: 'Post',
        on: {
          localFields: ['_id'],
          targetFields: ['authorId'],
        },
      });
      expect(validatedContract.contract.models['Post']?.relations['author']).toMatchObject({
        cardinality: 'N:1',
        to: 'User',
        on: {
          localFields: ['authorId'],
          targetFields: ['_id'],
        },
      });

      if (shouldUpdateExpected) {
        writeExpectedContractJson(fixtureCase, emittedPsl.contractJson);
      }

      expect(emittedPsl.contractJson).toBe(readExpectedContractJson(fixtureCase));
    },
    timeouts.typeScriptCompilation,
  );

  it('keeps the Postgres and Mongo examples structurally comparable', async () => {
    const postgresFixture = fixtureCases.find((candidate) => candidate.name === 'postgres');
    const mongoFixture = fixtureCases.find((candidate) => candidate.name === 'mongo');
    if (!postgresFixture || !mongoFixture) {
      throw new Error('Side-by-side fixtures not found');
    }

    const postgresContractJson = parseContractJson(readExpectedContractJson(postgresFixture));
    const mongoContractJson = parseContractJson(readExpectedContractJson(mongoFixture));

    expect(postgresContractJson['roots']).toEqual(mongoContractJson['roots']);

    const postgresModels = postgresContractJson['models'] as Record<
      string,
      Record<string, unknown>
    >;
    const mongoModels = mongoContractJson['models'] as Record<string, Record<string, unknown>>;

    expect(postgresModels['User']?.['relations']).toMatchObject({
      posts: { cardinality: '1:N', to: 'Post' },
    });
    expect(mongoModels['User']?.['relations']).toMatchObject({
      posts: { cardinality: '1:N', to: 'Post' },
    });
    expect(postgresModels['Post']?.['relations']).toMatchObject({
      author: { cardinality: 'N:1', to: 'User' },
    });
    expect(mongoModels['Post']?.['relations']).toMatchObject({
      author: { cardinality: 'N:1', to: 'User' },
    });
  });
});
