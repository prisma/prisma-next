#!/usr/bin/env node

import { Command } from 'commander';
import { createEmitCommand } from './commands/emit';

const program = new Command();

program.name('prisma-next').description('Prisma Next CLI').version('0.0.1');

program.addCommand(createEmitCommand());

program.parse();

