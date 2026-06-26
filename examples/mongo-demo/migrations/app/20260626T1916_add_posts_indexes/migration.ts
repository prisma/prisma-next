#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { createIndex } from '@prisma-next/target-mongo/migration';

class M extends Migration {
  override describe() {
    return {
      from: 'sha256:250af57beb0580c2c9562789d5d05ae39bcfabd08b2eca8367f59a70fa724b7d',
      to: 'sha256:ecc554e5f2f05ec120f8fef5ddf536286471edd3de11b8a906ba70e71f5e5df3',
    };
  }

  override get operations() {
    return [
      createIndex('posts', [{ direction: 1, field: 'authorId' }], {}),
      createIndex(
        'posts',
        [
          { direction: -1, field: 'createdAt' },
          { direction: 1, field: 'authorId' },
        ],
        {},
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
