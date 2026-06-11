#!/usr/bin/env -S node
import { Migration, MigrationCLI, setDefault } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:9b1657a8f40dda814d47ed3d8f4bdf704c0bf057cf6fc23b7b2090ce2748df20',
      to: 'sha256:372f890816e6e404f2365d11fca59175fa4e79ba84125ab08ca71c4561cf4581',
    };
  }

  override get operations() {
    return [setDefault('public', 'post', 'priority', "DEFAULT 'low'")];
  }
}

MigrationCLI.run(import.meta.url, M);
