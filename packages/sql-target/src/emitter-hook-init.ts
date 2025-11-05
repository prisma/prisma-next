import { targetFamilyRegistry } from '@prisma-next/emitter';
import { sqlTargetFamilyHook } from './emitter-hook';

targetFamilyRegistry.register(sqlTargetFamilyHook);

