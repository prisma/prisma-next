#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { createIndex } from '@prisma-next/target-mongo/migration';
import type { Contract as Start } from '../../snapshots/8ee1e7ce30ed334572583d826d9c41388c46f7db82ae2352c3a3fccf1de7cbab/contract';
import startContract from '../../snapshots/8ee1e7ce30ed334572583d826d9c41388c46f7db82ae2352c3a3fccf1de7cbab/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/059f3f35403c5a7a90851c23f1028e16d5250630f8a82fba33053e9a50534589/contract';
import endContract from '../../snapshots/059f3f35403c5a7a90851c23f1028e16d5250630f8a82fba33053e9a50534589/contract.json' with {
  type: 'json',
};

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

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
