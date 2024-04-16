const { defaults } = require('jest-config');

module.exports = {
  ...defaults,
  // 指定根目录
  rootDir: process.cwd(),
  // 忽略根目录下的 .history
  modulePathIgnorePatterns: ['<rootDir>/.history'],
  // 指定第三方依赖包的位置
  moduleDirectories: [...defaults.moduleDirectories, 'dist/node_modules'],
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^scheduler$': '<rootDir>/node_modules/scheduler/unstable_mock.js'
  },
  fakeTimers: {
    enableGlobally: true,
    legacyFakeTimers: true
  },
  setupFilesAfterEnv: ['./scripts/jest/setupJest.js']
};
