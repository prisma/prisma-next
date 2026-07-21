#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { createIndex } from '@prisma-next/target-mongo/migration';
import type { Contract as End } from '../../snapshots/2b8eb72bd167d1a8c60e1527bdb14fb6c1901407a121d27d117b314dd934cd7d/contract';
import endContract from '../../snapshots/2b8eb72bd167d1a8c60e1527bdb14fb6c1901407a121d27d117b314dd934cd7d/contract.json' with {
  type: 'json',
};
import type { Contract as Start } from '../../snapshots/79b46070809bf632b3742219ce1dd8924daf6350b2f478c4732962cf96288b6e/contract';
import startContract from '../../snapshots/79b46070809bf632b3742219ce1dd8924daf6350b2f478c4732962cf96288b6e/contract.json' with {
  type: 'json',
};

class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

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
