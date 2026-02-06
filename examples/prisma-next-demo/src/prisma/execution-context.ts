/**
 * @deprecated Import from './context' instead. This shim exists only for
 * backward compatibility during the migration and will be removed.
 */
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
export { executionContext, executionStack } from './context';

import { executionStack } from './context';
export const executionStackInstance = instantiateExecutionStack(executionStack);
