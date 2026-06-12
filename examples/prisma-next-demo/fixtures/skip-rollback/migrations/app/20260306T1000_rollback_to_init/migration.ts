#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:827997ce6f33b7193b0a9eda969affe757e0d54209fde344afcd4d41321c5078',
      to: 'sha256:789dd79ab5ab725be1b6ced088109b803a4d62f9874f932eb384a868d94360a4',
    };
  }

  override get operations() {
    return [
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'bio' }),
      this.dropColumn({ schema: '__unbound__', table: 'user', column: 'phone' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
