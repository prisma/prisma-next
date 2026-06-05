#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:f7a8eb5124c7d031e4c57f489cf2aa10c921333cd6caf7676993d9105d96e7f3',
      to: 'sha256:7c31c2e1119a16c7cc438e6fd132c34f0872d70bfbc3d2a888a4d5d44730d07b',
    };
  }

  override get operations() {
    // Empty-ops bookend that absorbs metadata-only reshapes between the
    // restored historical head and the current `public` layout: the
    // namespace-layout reshape (pre-domain.namespaces head →
    // `storage.namespaces.public`) and the storage-IR envelope reshape
    // (top-level `tables`/`enum` slots → the `entries.<kind>` envelope). No
    // table, column, or constraint moves — there is no DDL to emit; the
    // bookend only updates `from`/`to` so the next `migration plan` diffs
    // against a same-layout contract instead of reporting a disjoint
    // greenfield. Same pattern as the earlier 20260518T1701_namespaces_bookend.
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
