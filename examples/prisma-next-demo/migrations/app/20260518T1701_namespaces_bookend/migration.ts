#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:7c31c2e1119a16c7cc438e6fd132c34f0872d70bfbc3d2a888a4d5d44730d07b',
      to: 'sha256:7c31c2e1119a16c7cc438e6fd132c34f0872d70bfbc3d2a888a4d5d44730d07b',
    };
  }

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
