import { RelationsLowerer } from './types';
import { postgresLowerer } from './postgres';

class LowererRegistry {
  private lowerers = new Map<string, RelationsLowerer>();

  register(target: string, lowerer: RelationsLowerer): void {
    this.lowerers.set(target, lowerer);
  }

  get(target: string): RelationsLowerer {
    const lowerer = this.lowerers.get(target);
    if (!lowerer) {
      throw new Error(`No lowerer found for target: ${target}`);
    }
    return lowerer;
  }
}

export const lowererRegistry = new LowererRegistry();

// Register default lowerers
lowererRegistry.register('postgres', postgresLowerer);
