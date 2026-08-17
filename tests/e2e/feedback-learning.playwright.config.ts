import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'feedback-learning-isolated.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3101',
    trace: 'retain-on-failure',
  },
  ...(process.env.BB_FEEDBACK_EXISTING_HQ === 'true'
    ? {}
    : {
        webServer: {
          command: 'npm run dev:e2e -w @boomerbuddy/hq',
          url: 'http://127.0.0.1:3101',
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
  projects: [
    {
      name: 'edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
});
