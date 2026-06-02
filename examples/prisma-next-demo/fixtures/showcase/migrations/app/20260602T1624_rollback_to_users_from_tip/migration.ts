#!/usr/bin/env -S node
import { dropColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:f66098408da51786d8c6701a2b10db2e90f4b7e138eb5e95f84dc61e156d242b',
      to: 'sha256:419c09911c25cf9b97e60ee157c61a126accfa5f26f5cdb7954667c704f53753',
    };
  }

  override get operations() {
    return [
      dropColumn('__unbound__', 'account', 'avatar'),
      dropColumn('__unbound__', 'account', 'bio'),
      dropColumn('__unbound__', 'account', 'locale'),
      dropColumn('__unbound__', 'account', 'phone'),
      dropColumn('__unbound__', 'account', 'verified'),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
