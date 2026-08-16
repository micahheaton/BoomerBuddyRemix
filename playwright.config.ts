import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:e2e -w @boomerbuddy/api',
      url: 'http://127.0.0.1:4100/health/ready',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:e2e -w @boomerbuddy/web',
      url: 'http://127.0.0.1:3100',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:e2e -w @boomerbuddy/hq',
      url: 'http://127.0.0.1:3101',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
});
