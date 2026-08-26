import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'ui.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4177',
    colorScheme: 'dark',
    locale: 'en-US',
  },
  webServer: {
    command: 'node server.mjs',
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: true,
    timeout: 15_000,
  },
})
