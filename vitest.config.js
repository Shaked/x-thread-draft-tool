import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Two projects: the browser-like unit tests (jsdom) and the API tests (node, one shared
// migrated database snapshot from global-setup).
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./tests/unit/setup.js'],
          include: ['tests/unit/**/*.{test,spec}.{js,jsx,ts,tsx}'],
          css: false
        }
      },
      {
        test: {
          name: 'api',
          environment: 'node',
          include: ['tests/api/**/*.test.js'],
          globalSetup: ['tests/api/helpers/global-setup.js']
        }
      }
    ]
  }
})
