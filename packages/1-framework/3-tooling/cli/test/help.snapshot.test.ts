import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { createContractEmitCommand } from '../src/commands/contract-emit';
import { createDbIntrospectCommand } from '../src/commands/db-introspect';
import { createDbVerifyCommand } from '../src/commands/db-verify';
import { parseGlobalFlags } from '../src/utils/global-flags';
import { formatCommandHelp, formatRootHelp } from '../src/utils/output';

describe('help text snapshots', () => {
  it('formats root help', () => {
    const program = new Command();
    program.name('prisma-next').description('Prisma Next CLI');
    const contract = new Command('contract').description('Contract management commands');
    const contractEmit = createContractEmitCommand();
    contract.addCommand(contractEmit);
    const db = new Command('db').description('Database operations');
    const dbVerify = createDbVerifyCommand();
    db.addCommand(dbVerify);
    program.addCommand(contract);
    program.addCommand(db);

    // Explicitly disable colors for consistent snapshots
    const flags = parseGlobalFlags({ 'no-color': true });
    const helpText = formatRootHelp({ program, flags });

    expect(helpText).toMatchSnapshot();
  });

  it('formats contract emit help', () => {
    const command = createContractEmitCommand();
    // Explicitly disable colors for consistent snapshots
    const flags = parseGlobalFlags({ 'no-color': true });
    const helpText = formatCommandHelp({ command, flags });

    expect(helpText).toMatchSnapshot();
  });

  it('formats db verify help', () => {
    const command = createDbVerifyCommand();
    // Explicitly disable colors for consistent snapshots
    const flags = parseGlobalFlags({ 'no-color': true });
    const helpText = formatCommandHelp({ command, flags });

    expect(helpText).toMatchSnapshot();
  });

  it('formats root help with no color', () => {
    const program = new Command();
    program.name('prisma-next').description('Prisma Next CLI');
    const contract = new Command('contract').description('Contract management commands');
    const contractEmit = createContractEmitCommand();
    contract.addCommand(contractEmit);
    const db = new Command('db').description('Database operations');
    const dbVerify = createDbVerifyCommand();
    db.addCommand(dbVerify);
    program.addCommand(contract);
    program.addCommand(db);

    const flags = parseGlobalFlags({ 'no-color': true });
    const helpText = formatRootHelp({ program, flags });

    expect(helpText).toMatchSnapshot();
  });

  it('formats contract emit help with no color', () => {
    const command = createContractEmitCommand();
    const flags = parseGlobalFlags({ 'no-color': true });
    const helpText = formatCommandHelp({ command, flags });

    expect(helpText).toMatchSnapshot();
  });

  it('formats db introspect help', () => {
    const command = createDbIntrospectCommand();
    // Explicitly disable colors for consistent snapshots
    const flags = parseGlobalFlags({ 'no-color': true });
    const helpText = formatCommandHelp({ command, flags });

    expect(helpText).toMatchSnapshot();
  });
});
