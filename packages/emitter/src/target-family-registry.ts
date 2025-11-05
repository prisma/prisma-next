import type { TargetFamilyHook } from './target-family';

class TargetFamilyRegistry {
  private readonly hooks = new Map<string, TargetFamilyHook>();

  register(hook: TargetFamilyHook): void {
    if (this.hooks.has(hook.id)) {
      throw new Error(`Target family hook with id "${hook.id}" is already registered`);
    }
    this.hooks.set(hook.id, hook);
  }

  get(familyId: string): TargetFamilyHook | undefined {
    return this.hooks.get(familyId);
  }

  require(familyId: string): TargetFamilyHook {
    const hook = this.get(familyId);
    if (!hook) {
      throw new Error(`No target family hook registered for "${familyId}"`);
    }
    return hook;
  }

  has(familyId: string): boolean {
    return this.hooks.has(familyId);
  }
}

export const targetFamilyRegistry = new TargetFamilyRegistry();

