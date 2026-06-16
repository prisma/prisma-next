#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:3705eb1cd04a52180d1206181446bb87e18bb32afcc3d1dacbec685ca2d449d1',
      to: 'sha256:419c09911c25cf9b97e60ee157c61a126accfa5f26f5cdb7954667c704f53753',
    };
  }

  override get operations() {
    return [
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'avatar' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'bio' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'phone' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
