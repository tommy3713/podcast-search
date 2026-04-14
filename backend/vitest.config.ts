import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.{js,ts}'],
    env: {
      NODE_ENV: 'test',
      ELASTIC_URL: 'http://localhost:9200',
      ELASTIC_USERNAME: 'test',
      ELASTIC_PASSWORD: 'test',
      GOOGLE_CLIENT_ID: 'test-client-id',
      FRONTEND_URL: 'http://localhost:3001',
    },
  },
});
