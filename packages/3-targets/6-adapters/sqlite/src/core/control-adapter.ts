import type {
  ControlAdapterDescriptor,
  ControlAdapterInstance,
} from '@prisma-next/framework-components/control';
import { sqliteAdapterDescriptorMeta } from './descriptor-meta';

const sqliteControlAdapterDescriptor: ControlAdapterDescriptor<
  'sql',
  'sqlite',
  ControlAdapterInstance<'sql', 'sqlite'>
> = {
  ...sqliteAdapterDescriptorMeta,
  create(_stack): ControlAdapterInstance<'sql', 'sqlite'> {
    return { familyId: 'sql', targetId: 'sqlite' };
  },
};

export default sqliteControlAdapterDescriptor;
