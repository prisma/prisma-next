import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { emit } from '@prisma-next/emitter';
import { mongoTargetFamilyHook } from '@prisma-next/mongo-emitter';

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
  relations: {},
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

const MONGO_CODEC_TYPES = `{
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/int32@1': { readonly input: number; readonly output: number };
  readonly 'mongo/int64@1': { readonly input: bigint; readonly output: bigint };
  readonly 'mongo/double@1': { readonly input: number; readonly output: number };
  readonly 'mongo/bool@1': { readonly input: boolean; readonly output: boolean };
  readonly 'mongo/date@1': { readonly input: Date; readonly output: Date };
  readonly 'mongo/binary@1': { readonly input: Uint8Array; readonly output: Uint8Array };
}`;

async function main() {
  const result = await emit(blogIR, { outputDir: '.' }, mongoTargetFamilyHook);

  const contractDts = result.contractDts.replace(
    'export type CodecTypes = Record<string, never>;',
    `export type CodecTypes = ${MONGO_CODEC_TYPES};`,
  );
  if (contractDts === result.contractDts) {
    throw new Error('Failed to inject CodecTypes -- emitter output format may have changed');
  }

  const srcDir = resolve(import.meta.dirname, '..', 'src');
  writeFileSync(resolve(srcDir, 'contract.json'), result.contractJson + '\n');
  writeFileSync(resolve(srcDir, 'contract.d.ts'), contractDts);
  console.log('Generated contract.json and contract.d.ts in src/');
}

main().catch((err) => {
  console.error('Failed to generate contract:', err);
  process.exit(1);
});
