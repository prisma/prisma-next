#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:f66098408da51786d8c6701a2b10db2e90f4b7e138eb5e95f84dc61e156d242b',
      to: 'sha256:419c09911c25cf9b97e60ee157c61a126accfa5f26f5cdb7954667c704f53753',
    };
  }

  override get operations() {
    return [
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'avatar' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'bio' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'locale' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'phone' }),
      this.dropColumn({ schema: '__unbound__', table: 'account', column: 'verified' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
