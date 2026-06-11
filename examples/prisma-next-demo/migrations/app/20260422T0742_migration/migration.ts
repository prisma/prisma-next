#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:b1fd962de2b19a2a4fdf0dd04fb123a4d7681e318cbef09fdad6f016b5144bd9',
      to: 'sha256:a12e04d6c0659fefdb8f5082a555117c88092bd11fd66221d634c75ef9c0a1bc',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: 'public', table: 'user', column: col('displayName', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
