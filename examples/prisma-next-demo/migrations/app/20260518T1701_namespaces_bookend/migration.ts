#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:6cee6146eaf257ce236bf1144efb238a1087e45a62e04a8104a55d490d9029f4',
      to: 'sha256:f7a8eb5124c7d031e4c57f489cf2aa10c921333cd6caf7676993d9105d96e7f3',
    };
  }

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
