const path = require('node:path');

module.exports = {
  testDir: path.join(__dirname, 'e2e'),
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
  outputDir: path.join(__dirname, '..', 'tests', 'screenshots', 'playwright-results'),
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium',
      chromiumSandbox: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-crash-reporter',
        '--disable-crashpad',
      ],
    },
    viewport: { width: 1100, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
};
