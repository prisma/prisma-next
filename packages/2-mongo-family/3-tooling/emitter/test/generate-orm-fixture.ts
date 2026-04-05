import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Contract } from '@prisma-next/contract/types';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { mongoTargetFamilyHook } from '../src/index';

const codecImports = [
  {
    package: '@prisma-next/adapter-mongo/codec-types',
    named: 'CodecTypes',
    alias: 'MongoCodecTypes',
  },
];

const contract: Contract = {
  ...ormContractJson,
  target: 'mongo',
  profileHash: 'sha256:orm-profile',
  storage: {
    ...ormContractJson.storage,
    storageHash: 'sha256:orm-storage',
  },
  capabilities: {},
  extensionPacks: {},
  meta: {},
} as Contract;

const hashes = {
  storageHash: 'sha256:orm-storage',
  profileHash: 'sha256:orm-profile',
};

const output = mongoTargetFamilyHook.generateContractTypes(contract, codecImports, [], hashes);

const targets = [
  resolve(
    import.meta.dirname,
    '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.d.ts',
  ),
  resolve(
    import.meta.dirname,
    '../../../../../test/integration/test/mongo/fixtures/generated/contract.d.ts',
  ),
];

for (const target of targets) {
  writeFileSync(target, output);
  console.log(`Generated ${target}`);
}
