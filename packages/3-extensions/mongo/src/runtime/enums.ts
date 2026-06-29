import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@prisma-next/mongo-contract';
import { blindCast } from '@prisma-next/utils/casts';

export type UnboundEnums<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> = NamespacedEnums<TContract>[typeof UNBOUND_NAMESPACE_ID];

function unboundNamespace<T>(builderOutput: { readonly [UNBOUND_NAMESPACE_ID]?: unknown }): T {
  return blindCast<T, 'the unbound namespace always exists on a mongo builder output'>(
    builderOutput[UNBOUND_NAMESPACE_ID],
  );
}

export function buildEnums<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(domain: TContract['domain']): UnboundEnums<TContract> {
  return unboundNamespace<UnboundEnums<TContract>>(Object.freeze(buildNamespacedEnums(domain)));
}

/**
 * Builds enum accessors from a Mongo contract without requiring a connection.
 * Safe to import in client components — no driver or deserialization dependencies.
 * Returns the same `UnboundEnums` shape that `db.enums` exposes on a connected client.
 */
export function mongoEnums<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(
  options:
    | { readonly contractJson: unknown; readonly contract?: never }
    | { readonly contract: TContract; readonly contractJson?: never },
): UnboundEnums<TContract> {
  const domain =
    'contractJson' in options && options.contractJson !== undefined
      ? blindCast<TContract, 'contractJson carries the typed contract shape passed via TContract'>(
          options.contractJson,
        ).domain
      : blindCast<
          TContract,
          'contract branch: contract is always defined when contractJson is not'
        >(options.contract).domain;
  return buildEnums<TContract>(domain);
}
