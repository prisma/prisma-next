import mongoStatic from '@prisma-next/mongo/static';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export const enums = mongoStatic<Contract>({ contractJson }).enums;
