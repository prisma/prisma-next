#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { createIndex } from '@prisma-next/target-mongo/migration';

class M extends Migration {
  override describe() {
    return {
      from: 'sha256:8ee1e7ce30ed334572583d826d9c41388c46f7db82ae2352c3a3fccf1de7cbab',
      to: 'sha256:059f3f35403c5a7a90851c23f1028e16d5250630f8a82fba33053e9a50534589',
    };
  }

  override get operations() {
    return [
      createIndex(
        'products',
        [
          { direction: 1, field: 'primaryCategory' },
          { direction: 1, field: 'articleType' },
        ],
        {},
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
