#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { createIndex } from '@prisma-next/target-mongo/migration';

class M extends Migration {
  override describe() {
    return {
      from: 'sha256:f76977c7745bd6fbf38728c544b372927969f19955489d7ff5c9c1eddcdc0b36',
      to: 'sha256:8a15f8e37a3a8731578a87102f9507da65b5f84556f84320ea0ead82645e394d',
    };
  }

  override get operations() {
    return [
      createIndex(
        'products',
        [
          { direction: 1, field: 'masterCategory' },
          { direction: 1, field: 'articleType' },
        ],
        {},
      ),
    ];
  }
}

export default M;
MigrationCLI.run(import.meta.url, M);
