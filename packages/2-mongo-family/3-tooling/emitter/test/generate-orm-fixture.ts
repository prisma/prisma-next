import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Contract, coreHash, crossRef, profileHash } from '@prisma-next/contract/types';
import { generateContractDts } from '@prisma-next/emitter';
import { blindCast } from '@prisma-next/utils/casts';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { mongoEmission } from '../src/index';

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
  profileHash: profileHash('sha256:orm-profile'),
  roots: Object.fromEntries(
    Object.entries(ormContractJson.roots).map(([key, ref]) => [
      key,
      crossRef(ref.model, ref.namespace),
    ]),
  ),
  domain: blindCast<
    Contract['domain'],
    'orm-contract.json is a real emitted fixture; its cross-references carry plain-string namespace ids because JSON has no branded NamespaceId, same as any contract deserialized from disk'
  >(ormContractJson.domain),
  storage: {
    ...ormContractJson.storage,
    storageHash: coreHash('sha256:orm-storage'),
  },
  capabilities: {},
  extensions: {},
  meta: {},
} as Contract;

const hashes = {
  storageHash: 'sha256:orm-storage',
  profileHash: 'sha256:orm-profile',
};

const output = generateContractDts(contract, mongoEmission, codecImports, hashes);

const targets = [
  resolve(
    import.meta.dirname,
    '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.d.ts',
  ),
];

for (const target of targets) {
  writeFileSync(target, output);
  console.log(`Generated ${target}`);
}
