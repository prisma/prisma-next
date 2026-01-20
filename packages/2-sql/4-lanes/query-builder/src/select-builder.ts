import type { SqlContract } from '@prisma-next/sql-contract/types';

/**
 * A builder for SQL `select` queries.
 *
 * @template TContract The contract that describes the database.
 * @template _TTables The tables involved in the current `select` query.
 */
export class SelectBuilder<
  TContract extends SqlContract,
  _TTables extends SqlContract['storage']['tables'],
> {
  // @ts-expect-error
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: will be used soon.
  readonly #contract: TContract;

  constructor(contract: TContract) {
    this.#contract = contract;
  }

  build() {
    // noop
  }
}
