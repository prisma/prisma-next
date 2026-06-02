#!/usr/bin/env -S node
import { dropColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:f5aa17d46d7be94ca3ddf4d14d90e0444291d9c063c52d0e05455726e52e0026',
      to: 'sha256:3bfce91c81146b347dc05f423a71907a82d8b2e78ab5714b2bfab673f673d021',
    };
  }

  override get operations() {
    return [
      dropColumn('__unbound__', 'account', 'name'),
      dropColumn('__unbound__', 'account', 'phone'),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
