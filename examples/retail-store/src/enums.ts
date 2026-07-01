import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import { blindCast } from '@prisma-next/utils/casts';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };
// Interim: build the enum accessors from the static contract with a blindCast.
// TML-2955 will expose @prisma-next/mongo/static so the typing comes from the
// framework and this whole module can be deleted.
export const enums = blindCast<
  NamespacedEnums<Contract>['__unbound__'],
  'buildNamespacedEnums returns untyped EnumAccessor; cast to the typed shape from Contract'
>(buildNamespacedEnums(contractJson.domain)['__unbound__']);
