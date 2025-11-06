import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { createEmitCommand } from '../src/commands/emit';

describe('CLI entry point', () => {
  let originalExit: typeof process.exit;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let consoleOutput: string[] = [];
  let consoleErrors: string[] = [];

  beforeEach(() => {
    originalExit = process.exit;
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    consoleOutput = [];
    consoleErrors = [];

    process.exit = vi.fn(() => {
      throw new Error('process.exit called');
    }) as typeof process.exit;

    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    }) as typeof console.log;

    console.error = vi.fn((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    }) as typeof console.error;
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it('creates program with correct name and description', () => {
    const program = new Command();
    program.name('prisma-next').description('Prisma Next CLI').version('0.0.1');
    program.addCommand(createEmitCommand());

    expect(program.name()).toBe('prisma-next');
    expect(program.description()).toBe('Prisma Next CLI');
  });

  it('registers emit command', () => {
    const program = new Command();
    program.name('prisma-next').description('Prisma Next CLI').version('0.0.1');
    program.addCommand(createEmitCommand());

    const emitCommand = program.commands.find((cmd) => cmd.name() === 'emit');
    expect(emitCommand).toBeDefined();
    expect(emitCommand?.description()).toContain('Emit contract.json');
  });

  it('has version command', () => {
    const program = new Command();
    program.name('prisma-next').description('Prisma Next CLI').version('0.0.1');

    expect(program.version()).toBe('0.0.1');
  });
});

