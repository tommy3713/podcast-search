import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  node: process.env.ELASTIC_URL,
  auth: {
    username: process.env.ELASTIC_USERNAME,
    password: process.env.ELASTIC_PASSWORD,
  },
});

const INDEX = 'podcast';

export const search = async (keyword) => {
  const result = await client.search({
    index: INDEX,
    body: {
      query: {
        match: { content: keyword },
      },
      highlight: {
        fields: { content: {} },
        pre_tags: ['{{HIGHLIGHT}}'],
        post_tags: ['{{/HIGHLIGHT}}'],
      },
      _source: { excludes: ['content'] },
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

export const getPodcastByPodcasterAndEpisode = async (podcaster, episode) => {
  const result = await client.search({
    index: INDEX,
    body: {
      query: {
        bool: {
          must: [
            { term: { podcaster: podcaster } },
            { term: { episode: episode } },
          ],
        },
      },
      _source: { excludes: ['content'] },
      size: 1,
    },
  });

  const hit = result.hits.hits[0];
  if (!hit) return null;

  const document = hit._source;
  if (document.note) {
    document.noteSections = document.note
      .split('- ')
      .filter((section) => section.trim() !== '');
  }
  return document;
};

export const getPodcastTranscriptByPodcasterAndEpisode = async (podcaster, episode) => {
  const result = await client.search({
    index: INDEX,
    body: {
      query: {
        bool: {
          must: [
            { term: { podcaster: podcaster } },
            { term: { episode: episode } },
          ],
        },
      },
      _source: ['content'],
      size: 1,
    },
  });

  const hit = result.hits.hits[0];
  if (!hit) return null;
  return { content: hit._source.content };
};

export const getPodcasts = async (page = 1, limit = 10) => {
  const result = await client.search({
    index: INDEX,
    body: {
      query: { match_all: {} },
      sort: [{ uploadDate: { order: 'desc' } }],
      _source: ['title', 'uploadDate', 'episode', 'fullTitle', 'podcaster'],
      from: (page - 1) * limit,
      size: limit,
    },
  });

  return result.hits.hits.map((hit) => hit._source);
};
