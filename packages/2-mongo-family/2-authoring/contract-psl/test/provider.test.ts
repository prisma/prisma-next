import { describe, expect, it } from 'vitest';
import { mongoContract } from '../src/exports/provider';

describe('mongoContract provider helper', () => {
  it('exposes watch inputs from schema path', () => {
    const config = mongoContract('./schema.prisma', {
      output: 'output/contract.json',
    });

    expect(config.output).toBe('output/contract.json');
    expect(config.source.inputs).toEqual(['./schema.prisma']);
  });
});
