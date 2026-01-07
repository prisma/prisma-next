export default {
  '*.{ts,tsx,js,jsx,json,jsonc}': ['biome format --write', 'biome check --write'],
  // when there are too many staged files, lint-staged can exceed the max command line length limit.
  // the script checks git anyway, so we can just run it without passing filenames as args.
  '*.{ts,tsx,js,jsx}': () => 'node scripts/lint-deps-focused.mjs',
};
