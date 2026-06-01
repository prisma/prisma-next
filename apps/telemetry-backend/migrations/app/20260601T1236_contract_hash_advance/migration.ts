#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:41700ef5fda97339b39ea345a56aae72a1ff4be11ddc3ffcab7130bfc71c109d',
      to: 'sha256:b3b741a267f995ab52646b2cba176c396e7e2b651e78d048382dc9dc9399dd96',
    };
  }

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
