import type {
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
} from '@prisma-next/framework-components/execution';
import { ppgServerlessDriverDescriptorMeta } from '../core/descriptor-meta';

const NOT_IMPLEMENTED_MESSAGE =
  'driver-ppg-serverless: runtime not yet implemented; this is a placeholder descriptor with no transport bound';

class PpgServerlessUnboundDriver implements RuntimeDriverInstance<'sql', 'postgres'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  get state(): 'unbound' {
    return 'unbound';
  }

  async connect(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }

  async acquireConnection(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }

  async close(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }

  execute(): never {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }

  executePrepared(): never {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }

  async query(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }

  async explain(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }
}

const ppgServerlessRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'postgres',
  undefined,
  RuntimeDriverInstance<'sql', 'postgres'>
> = {
  ...ppgServerlessDriverDescriptorMeta,
  create(): RuntimeDriverInstance<'sql', 'postgres'> {
    return new PpgServerlessUnboundDriver();
  },
};

export default ppgServerlessRuntimeDriverDescriptor;
