import { SqlRuntimeFamilyDescriptor } from '../core/runtime-descriptor';

/**
 * SQL runtime family descriptor for execution/runtime plane.
 * Identity-only entrypoint (no runtime creation API).
 *
 * Runtime creation should use the stack/context/runtime factory pattern directly:
 * - createExecutionStack({ target, adapter, driver, extensionPacks })
 * - instantiateExecutionStack(stack)
 * - createExecutionContext({ contract, stack: stackInstance })
 * - createRuntime({ stack: stackInstance, contract, context, driverOptions, verify, ... })
 */
export default new SqlRuntimeFamilyDescriptor();
