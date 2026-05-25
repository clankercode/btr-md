const path = require('node:path');

const PORT = Number(process.env.PMD_TEST_PORT || 4173);

module.exports = {
  testDir: path.join(__dirname, 'e2e'),
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
  outputDir: path.join(__dirname, '..', 'tests', 'screenshots', 'playwright-results'),
  reporter: [['list']],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    cwd: __dirname,
    port: PORT,
    timeout: 10_000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
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
