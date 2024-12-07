import { Client } from '@elastic/elasticsearch';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();
const client = new Client({
  node: process.env.ELASTIC_URL,
  auth: {
    username: process.env.ELASTIC_USERNAME,
    password: process.env.ELASTIC_PASSWORD,
  },
});

export const search = async (keyword) => {
  console.log('Client', client.nodes);
  const result = await client.search({
    index: 'podcast',
    body: {
      query: {
        match: { content: keyword },
      },
      highlight: {
        fields: {
          content: {},
        },
        pre_tags: ['{{HIGHLIGHT}}'],
        post_tags: ['{{/HIGHLIGHT}}'],
      },
      _source: {
        excludes: ['content'],
      },
    },
  });
  return result.hits.hits.map((hit) => ({
    podcaster: hit._source.podcaster,
    title: hit._source.title,
    uploadDate: hit._source.uploadDate,
    episode: hit._source.episode,
    fullTitle: hit._source.fullTitle,
    highlights: hit.highlight.content,
  }));
};
