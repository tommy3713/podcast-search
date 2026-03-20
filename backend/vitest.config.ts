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
      MONGO_URI: 'mongodb://localhost:27017',
      MONGO_DB: 'testDB',
      MONGO_COLLECTION: 'episodes',
      GOOGLE_CLIENT_ID: 'test-client-id',
      FRONTEND_URL: 'http://localhost:3001',
    },
  },
});
