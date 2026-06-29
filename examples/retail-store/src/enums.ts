import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import { blindCast } from '@prisma-next/utils/casts';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };
export const enums = blindCast<
  NamespacedEnums<Contract>['__unbound__'],
  'buildNamespacedEnums returns untyped EnumAccessor; cast to the typed shape from Contract'
>(buildNamespacedEnums(contractJson.domain)['__unbound__']);
