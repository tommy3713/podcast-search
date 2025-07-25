import Layout from './layout';

export default function Home() {
  return (
    <Layout>
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">
          Welcome to Podcast Search
        </h1>
        <p className="text-gray-600">Use the menu above to navigate.</p>
      </div>
    </Layout>
  );
}
