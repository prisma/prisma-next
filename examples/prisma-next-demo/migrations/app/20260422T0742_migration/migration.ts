#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:243450a642aa1368a4ab49b4fcc61bf0b7ae1569e40db03c7510bbd029de64b2',
      to: 'sha256:b6500906de64a9e926fe4c18e5244dc56a62af097f5936a040e7ab55b42275b3',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: 'public', table: 'user', column: col('displayName', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
