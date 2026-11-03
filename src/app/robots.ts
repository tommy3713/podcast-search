import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

// The content is a fan's notes on someone else's show, so crawlers that only collect
// training data for AI models are turned away. Search engines and AI search tools that
// link back (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, ...) stay allowed.
// Cloudflare prepends its own content-signal comments to this file.
const TRAINING_ONLY = [
  'GPTBot',
  'ClaudeBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'meta-externalagent',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: '/api/' },
      { userAgent: TRAINING_ONLY, disallow: '/' },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
