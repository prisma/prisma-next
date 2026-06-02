#!/usr/bin/env -S node
import { dropColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:bf158ef32daace0a629bfdac5d569b0d43cd81e257e2463aef2545638e2c7585',
      to: 'sha256:419c09911c25cf9b97e60ee157c61a126accfa5f26f5cdb7954667c704f53753',
    };
  }

  override get operations() {
    return [
      dropColumn('__unbound__', 'account', 'avatar'),
      dropColumn('__unbound__', 'account', 'bio'),
      dropColumn('__unbound__', 'account', 'locale'),
      dropColumn('__unbound__', 'account', 'phone'),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
