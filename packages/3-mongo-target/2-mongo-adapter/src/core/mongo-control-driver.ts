import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import type { MongoControlDriverInstance } from '@prisma-next/mongo-lowering';

export function isMongoControlDriver(
  driver: ControlDriverInstance<'mongo', string>,
): driver is MongoControlDriverInstance {
  return (
    driver.familyId === 'mongo' &&
    driver.targetId === 'mongo' &&
    'execute' in driver &&
    typeof driver.execute === 'function'
  );
}
