import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorUnexpected,
} from '../../src/utils/cli-errors';
import { parseGlobalFlags } from '../../src/utils/global-flags';
import { TerminalUI } from '../../src/utils/terminal-ui';
import { setupCommandMocks } from '../utils/test-helpers';

type InspectLiveSchema =
  typeof import('../../src/commands/inspect-live-schema')['inspectLiveSchema'];

const mocks = vi.hoisted(() => {
  const loadConfigMock = vi.fn();
  const introspectMock = vi.fn();
  const toSchemaViewMock = vi.fn();
  const closeMock = vi.fn();
  const createControlClientMock = vi.fn(() => ({
    introspect: introspectMock,
    toSchemaView: toSchemaViewMock,
    close: closeMock,
  }));

  return {
    loadConfigMock,
    introspectMock,
    toSchemaViewMock,
    closeMock,
    createControlClientMock,
  };
});

vi.mock('../../src/config-loader', () => ({
  loadConfig: mocks.loadConfigMock,
}));

vi.mock('../../src/control-api/client', () => ({
  createControlClient: mocks.createControlClientMock,
}));

const baseConfig = {
  family: { familyId: 'sql' },
  target: { targetId: 'postgres' },
  adapter: {},
  driver: {},
  db: {
    connection: 'postgres://config_user:config_pass@localhost:5432/from_config',
  },
} as const;

const schemaIR = {
  tables: {},
  dependencies: [],
} as const;

const context = {
  commandName: 'db schema',
  description: 'Inspect the live database schema',
  url: 'https://pris.ly/db-schema',
} as const;

describe('inspectLiveSchema', () => {
  let consoleErrors: string[] = [];
  let cleanupMocks: () => void = () => {};
  let inspectLiveSchema: InspectLiveSchema;

  beforeEach(async () => {
    vi.resetModules();
    ({ inspectLiveSchema } = await import('../../src/commands/inspect-live-schema'));

    const commandMocks = setupCommandMocks();
    consoleErrors = commandMocks.consoleErrors;
    cleanupMocks = commandMocks.cleanup;

    mocks.loadConfigMock.mockResolvedValue(baseConfig);
    mocks.introspectMock.mockResolvedValue(schemaIR);
    mocks.toSchemaViewMock.mockReturnValue(undefined);
    mocks.closeMock.mockResolvedValue(undefined);
    mocks.createControlClientMock.mockClear();
  }, timeouts.typeScriptCompilation);

  afterEach(() => {
    cleanupMocks();
    vi.clearAllMocks();
  });

  function createUi() {
    const flags = parseGlobalFlags({ 'no-color': true });
    const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });
    return { flags, ui };
  }

  it('uses the explicit db url, masks it in output/meta, and falls back to the default config path', async () => {
    mocks.loadConfigMock.mockResolvedValue({
      ...baseConfig,
      extensionPacks: undefined,
    });

    const { flags, ui } = createUi();
    const result = await inspectLiveSchema(
      { db: 'postgres://flag_user:flag_pass@localhost:5432/from_flag' },
      flags,
      ui,
      0,
      context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.meta).toEqual({
      configPath: 'prisma-next.config.ts',
      dbUrl: 'postgres://****:****@localhost:5432/from_flag',
    });
    expect(mocks.createControlClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionPacks: [],
      }),
    );
    expect(mocks.introspectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: 'postgres://flag_user:flag_pass@localhost:5432/from_flag',
        onProgress: expect.any(Function),
      }),
    );
    expect(consoleErrors.join('\n')).toContain('postgres://****:****@localhost:5432/from_flag');
  });

  it('returns a database connection error when no db url is available', async () => {
    mocks.loadConfigMock.mockResolvedValue({
      ...baseConfig,
      db: undefined,
    });

    const { flags, ui } = createUi();
    const result = await inspectLiveSchema({}, flags, ui, 0, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.toEnvelope().code).toBe(
      errorDatabaseConnectionRequired().toEnvelope().code,
    );
  });

  it('returns a driver error when config.driver is missing', async () => {
    mocks.loadConfigMock.mockResolvedValue({
      ...baseConfig,
      driver: undefined,
    });

    const { flags, ui } = createUi();
    const result = await inspectLiveSchema({}, flags, ui, 0, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.toEnvelope().code).toBe(errorDriverRequired().toEnvelope().code);
  });

  it('passes through structured config-loading errors unchanged', async () => {
    const configError = errorDriverRequired({ why: 'broken config file' });
    mocks.loadConfigMock.mockRejectedValue(configError);

    const { flags, ui } = createUi();
    const result = await inspectLiveSchema({}, flags, ui, 0, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.toEnvelope().code).toBe(configError.toEnvelope().code);
  });

  it('wraps unexpected config-loading errors', async () => {
    mocks.loadConfigMock.mockRejectedValue(new Error('boom'));

    const { flags, ui } = createUi();
    const result = await inspectLiveSchema({}, flags, ui, 0, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.toEnvelope().code).toBe(
      errorUnexpected('boom', { why: 'Failed to load config' }).toEnvelope().code,
    );
  });

  it('wraps non-Error config-loading failures', async () => {
    mocks.loadConfigMock.mockRejectedValue('boom');

    const { flags, ui } = createUi();
    const result = await inspectLiveSchema({}, flags, ui, 0, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.toEnvelope().code).toBe(
      errorUnexpected('boom', { why: 'Failed to load config' }).toEnvelope().code,
    );
  });

  it('omits masked db metadata when the configured connection is not a url string', async () => {
    mocks.loadConfigMock.mockResolvedValue({
      ...baseConfig,
      db: {
        connection: { host: 'localhost', port: 5432 },
      },
    });

    const { flags, ui } = createUi();
    const result = await inspectLiveSchema({}, flags, ui, 0, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meta).toEqual({
      configPath: 'prisma-next.config.ts',
    });
    expect(consoleErrors.join('\n')).not.toContain('localhost:5432');
  });

  it('passes through structured introspection errors and always closes the client', async () => {
    const introspectError = errorUnexpected('driver exploded');
    mocks.introspectMock.mockRejectedValue(introspectError);

    const { flags, ui } = createUi();
    const result = await inspectLiveSchema({}, flags, ui, 0, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.toEnvelope().code).toBe(introspectError.toEnvelope().code);
    expect(mocks.closeMock).toHaveBeenCalledTimes(1);
  });

  it('wraps unexpected Error introspection failures and always closes the client', async () => {
    mocks.introspectMock.mockRejectedValue(new Error('boom'));

    const { flags, ui } = createUi();
    const result = await inspectLiveSchema({}, flags, ui, 0, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.toEnvelope().code).toBe(
      errorUnexpected('boom', {
        why: 'Unexpected error during db schema: boom',
      }).toEnvelope().code,
    );
    expect(mocks.closeMock).toHaveBeenCalledTimes(1);
  });

  it('wraps non-Error introspection failures and always closes the client', async () => {
    mocks.introspectMock.mockRejectedValue('boom');

    const { flags, ui } = createUi();
    const result = await inspectLiveSchema({}, flags, ui, 0, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.toEnvelope().code).toBe(
      errorUnexpected('boom', {
        why: 'Unexpected error during db schema: boom',
      }).toEnvelope().code,
    );
    expect(mocks.closeMock).toHaveBeenCalledTimes(1);
  });
});
