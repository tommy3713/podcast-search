import express from 'express';
import cors from 'cors';
import { Client } from '@elastic/elasticsearch';
import path from 'path';
import fs from 'fs';
import { json } from 'stream/consumers';
import { fileURLToPath } from 'url';
import { search } from './service.js';
const app = express();
const port = 3000;

app.use(
  cors({
    origin: process.env.FRONTEND_URL, // Set the allowed origin to your frontend's URL
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
app.get('/init', async (req, res) => {
  try {
    init();
    res.send({ message: 'Data initialized' });
  } catch (error) {
    res.status(500).send(error);
  }
});
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
