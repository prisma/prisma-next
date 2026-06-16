#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:3db2cb9bd69609a89ee049f99a464cae59bd531db8a646066addebbeeaf8bbc7',
      to: 'sha256:1ba85eb0c552251d354c5a6c23fe9b4cd8a6cf6675d0ef9e86427c85d2c23e28',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: 'public', table: 'user', column: col('displayName', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
