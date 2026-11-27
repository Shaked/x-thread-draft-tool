import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { TimedShardSequencer } from './tests/shard-sequencer.mjs'

// Two projects: the browser-like unit tests (jsdom) and the API tests (node, one shared
// migrated database snapshot from global-setup). --shard=n/m splits the files by time (#605).
export default defineConfig({
  test: {
    sequence: { sequencer: TimedShardSequencer },
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
          setupFiles: ['./tests/api/helpers/metrics-off.js'],
          globalSetup: ['tests/api/helpers/global-setup.js']
        }
      }
    ]
  }
})
