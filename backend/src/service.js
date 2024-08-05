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

export const init = async () => {
  const directoryPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '/data'
  );
  // Asynchronously read the directory
  fs.readdir(directoryPath, (err, files) => {
    if (err) {
      console.error('Error reading directory:', err);
      return;
    }
    // Filter and process only .json files
    files.forEach((file) => {
      if (path.extname(file) === '.json') {
        // Construct full file path
        let filePath = path.join(directoryPath, file);
        // Read and parse the JSON file
        fs.readFile(filePath, 'utf8', async (err, data) => {
          if (err) {
            console.error(`Error reading file ${file}:`, err);
            return;
          }
          // Parse and output the file content
          const jsonData = JSON.parse(data);
          console.log(`Data from ${file}:`, jsonData.uploadDate);
          console.log(`Data from ${file}:`, jsonData.podcaster);
          console.log(`Data from ${file}:`, jsonData.title);
          console.log(`Data from ${file}:`, jsonData.episode);
          console.log(`Data from ${file}:`, jsonData.fullTitle);
          const response = await client.index({
            index: 'podcast',
            document: {
              podcaster: jsonData.podcaster,
              content: jsonData.content,
              title: jsonData.title,
              uploadDate: jsonData.uploadDate,
              episode: jsonData.episode,
              fullTitle: jsonData.fullTitle,
            },
          });
          await client.indices.refresh({ index: 'podcast' });
          console.log(`Data indexed:`, response);
        });
      }
    });
  });
};
