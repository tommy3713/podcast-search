import { Client } from '@elastic/elasticsearch';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  node: process.env.ELASTIC_URL,
  auth: {
    username: process.env.ELASTIC_USERNAME,
    password: process.env.ELASTIC_PASSWORD,
  },
});

const mongoUri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB;
const collectionName = process.env.MONGO_COLLECTION;
const mongoClient = new MongoClient(mongoUri);

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

export const getPodcastByPodcasterAndEpisode = async (podcaster, episode) => {
  try {
    // Connect to MongoDB
    await mongoClient.connect();
    const database = mongoClient.db(dbName);
    const collection = database.collection(collectionName);

    // Query for the document with the specified fullTitle
    const document = await collection.findOne(
      { podcaster: podcaster, episode: episode },
      { projection: { content: 0 } }
    );
    return document;
  } catch (error) {
    console.error('Error fetching note:', error);
    throw new Error('Failed to fetch note');
  } finally {
    // Close the MongoDB connection
    await mongoClient.close();
  }
};
