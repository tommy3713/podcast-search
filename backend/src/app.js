import express from 'express';
import cors from 'cors';
import { Client } from '@elastic/elasticsearch';
import path from 'path';
import fs from 'fs';
import { json } from 'stream/consumers';
import { fileURLToPath } from 'url';
import { search, initES } from './service.js';
const app = express();
const port = 3000;

const allowedOrigins = [
  process.env.FRONTEND_URL, // Production frontend URL
  'http://localhost:3001', // Common localhost for frontend development
  'http://127.0.0.1:3001', // Handle 127.0.0.1 if using that instead
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else if (/^http:\/\/localhost:\d+$/.test(origin)) {
        // Allow any localhost port
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);
app.get('/api/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    const result = await search(keyword);
    res.send(result);
  } catch (error) {
    console.log(error);
    res.status(500).send(error.message);
  }
});

app.get('/hello', (req, res) => {
  res.send({ message: 'Hello World!' });
});
