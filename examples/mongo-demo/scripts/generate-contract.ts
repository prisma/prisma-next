import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { mongoFamilyDescriptor, mongoTargetDescriptor } from '@prisma-next/family-mongo/control';
import { createControlStack } from '@prisma-next/framework-components/control';

const blogIR: ContractIR = {
  schemaVersion: '1',
  targetFamily: 'mongo',
  target: 'mongo',
  roots: {
    users: 'User',
    posts: 'Post',
  },
  models: {
    User: {
      fields: {
        _id: { codecId: 'mongo/objectId@1', nullable: false },
        name: { codecId: 'mongo/string@1', nullable: false },
        email: { codecId: 'mongo/string@1', nullable: false },
        bio: { codecId: 'mongo/string@1', nullable: true },
      },
      relations: {
        posts: {
          to: 'Post',
          cardinality: '1:N',
          on: { localFields: ['_id'], targetFields: ['authorId'] },
        },
      },
      storage: { collection: 'users' },
    },
    Post: {
      fields: {
        _id: { codecId: 'mongo/objectId@1', nullable: false },
        title: { codecId: 'mongo/string@1', nullable: false },
        content: { codecId: 'mongo/string@1', nullable: false },
        authorId: { codecId: 'mongo/objectId@1', nullable: false },
        createdAt: { codecId: 'mongo/date@1', nullable: false },
      },
      relations: {
        author: {
          to: 'User',
          cardinality: 'N:1',
          on: { localFields: ['authorId'], targetFields: ['_id'] },
        },
      },
      storage: { collection: 'posts' },
    },
  },
  storage: {
    collections: {
      users: {},
      posts: {},
    },
  },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
};

async function main() {
  const controlStack = createControlStack({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
  });

  const instance = mongoFamilyDescriptor.create(controlStack);

  const result = await instance.emitContract({ contractIR: blogIR });

  const srcDir = resolve(import.meta.dirname, '..', 'src');
  writeFileSync(resolve(srcDir, 'contract.json'), result.contractJson + '\n');
  writeFileSync(resolve(srcDir, 'contract.d.ts'), result.contractDts);
  console.log('Generated contract.json and contract.d.ts in src/');
}

main().catch((err) => {
  console.error('Failed to generate contract:', err);
  process.exit(1);
});
