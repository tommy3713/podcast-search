import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import {
  search,
  getPodcastByPodcasterAndEpisode,
  getPodcasts,
  getPodcastTranscriptByPodcasterAndEpisode,
  askWithContext,
} from './service.js';
import verifyGoogleToken from './middleware/verifyGoogleToken.js';

const app = express();
const port = 3000;

const allowedOrigins = [
  process.env.FRONTEND_URL, // Production frontend URL
  'http://localhost:3001', // Common localhost for frontend development
  'http://127.0.0.1:3001', // Handle 127.0.0.1 if using that instead
];

app.use(express.json());
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

app.get('/api/podcast/summary', verifyGoogleToken, async (req, res) => {
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
app.get('/api/podcast/transcript', async (req, res) => {
  const { podcaster, episode } = req.query;

  if (!podcaster) {
    return res.status(400).json({ error: 'fullTitle is required' });
  }
  if (!episode) {
    return res.status(400).json({ error: 'episode is required' });
  }

  try {
    const document = await getPodcastTranscriptByPodcasterAndEpisode(
      podcaster,
      episode
    );
    if (document) {
      res.json(document);
    } else {
      res.status(404).json({ error: 'Document not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/podcast/all', async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  try {
    const podcasts = await getPodcasts(parseInt(page), parseInt(limit));
    res.json(podcasts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const askRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 20,
  keyGenerator: (req) => req.user?.sub ?? req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: '每日提問次數已達上限（20 次），請明天再試。' });
  },
  skip: () => process.env.NODE_ENV === 'test',
});

app.post('/api/ask', verifyGoogleToken, askRateLimiter, async (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: '問題長度不能超過 500 字元。' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    await askWithContext(
      question,
      (content) => res.write(`data: ${JSON.stringify({ content })}\n\n`),
      () => {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    );
  } catch (error) {
    console.error(error);
    res.write(`data: ${JSON.stringify({ error: 'Failed to generate response' })}\n\n`);
    res.end();
  }
});

app.get('/hello', (req, res) => {
  res.send({ message: 'Hello World!' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

export default app;
