import { mongoEnums } from '@prisma-next/mongo/enums';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export const enums = mongoEnums<Contract>({ contractJson });
