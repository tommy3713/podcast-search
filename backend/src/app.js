import express from 'express';
import cors from 'cors';
import { search, getPodcastByPodcasterAndEpisode } from './service.js';
import { MongoClient } from 'mongodb';
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

app.get('/api/podcast/summary', async (req, res) => {
  const { podcaster, episode } = req.query;

  if (!podcaster) {
    return res.status(400).json({ error: 'fullTitle is required' });
  }
  if (!episode) {
    return res.status(400).json({ error: 'episode is required' });
  }

  try {
    const document = await getPodcastByPodcasterAndEpisode(podcaster, episode);
    if (document) {
      res.json(document);
    } else {
      res.status(404).json({ error: 'Document not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/hello', (req, res) => {
  res.send({ message: 'Hello World!' });
});
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
