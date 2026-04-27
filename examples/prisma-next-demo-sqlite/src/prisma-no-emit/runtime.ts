import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';
import { createRuntime, type Runtime, type SqlMiddleware } from '@prisma-next/sql-runtime';
import { context, stack } from './context';

export async function getRuntime(
  databasePath: string,
  middleware: SqlMiddleware[] = [createTelemetryMiddleware()],
): Promise<Runtime> {
  const stackInstance = instantiateExecutionStack(stack);
  const driver = stackInstance.driver;
  if (!driver) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  await driver.connect({ kind: 'path', path: databasePath });

  return createRuntime({
    stackInstance,
    context,
    driver,
    verify: {
      mode: 'onFirstUse',
      requireMarker: false,
    },
    middleware,
  });
}
