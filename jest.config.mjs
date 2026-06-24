/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  // ESM preset: transforms .ts with useESM and treats .ts as ES modules.
  // Tests run with NODE_OPTIONS=--experimental-vm-modules (see package.json).
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Allow relative imports written with a `.js` extension (NodeNext style) to
  // resolve to their `.ts` source. No-op for extensionless imports.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  clearMocks: true,
};
