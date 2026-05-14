import type { ControlTargetDescriptor } from '@prisma-next/framework-components/control';

/**
 * Minimal stub `MigratableTargetDescriptor` for tests that only need a
 * target slot on the control stack. Real target wiring lives in
 * `@prisma-next/target-mongo`; pulling that package in here would
 * recreate the `family-mongo → target-mongo` runtime cycle this
 * milestone severs (`adapter-mongo` and `target-mongo` already depend
 * on `family-mongo`; the family layer must stay leaf-clean).
 */
export const stubMongoTargetDescriptor: ControlTargetDescriptor<'mongo', 'mongo'> = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  create() {
    return { familyId: 'mongo', targetId: 'mongo' };
  },
};
