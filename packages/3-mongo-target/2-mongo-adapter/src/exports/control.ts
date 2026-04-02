import type { ControlAdapterDescriptor } from '@prisma-next/config/types';

const mongoAdapterDescriptor: ControlAdapterDescriptor<'mongo', 'mongo'> = {
  kind: 'adapter',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  create() {
    return { familyId: 'mongo' as const, targetId: 'mongo' as const };
  },
};

export default mongoAdapterDescriptor;
