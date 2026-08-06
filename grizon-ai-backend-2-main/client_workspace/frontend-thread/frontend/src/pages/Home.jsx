import React, { useEffect, useState } from 'react';

const DocumentCard = ({ document }) => {
  if (!document) return null;
  return (
    <div className="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-md hover:border-blue-500 transition-all">
      <h3 className="text-lg font-bold text-white mb-2">{document.title || document.name || 'Untitled Document'}</h3>
      <p className="text-sm text-gray-400 mb-4">{document.description || 'Document overview and summary details.'}</p>
    </div>
  );
};

const Home = () => {
  const [documents] = useState([
    { id: '1', title: 'System Overview.pdf', description: 'Complete architecture flow documentation.' },
    { id: '2', title: 'API Specification.docx', description: 'REST API schemas and authentication guide.' }
  ]);

  return (
    <div className="container mx-auto p-4">
      <section className="hero bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-10 rounded-2xl shadow-xl">
        <h1 className="text-4xl font-bold">Welcome to Universal Brain Documentation</h1>
        <p className="mt-4 text-lg opacity-90">Your one-stop solution for all system insights, multimodal vision, and APIs.</p>
      </section>
      <section className="featured-docs my-10">
        <h2 className="text-3xl font-bold mb-6 text-white">Featured Documentation</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {documents.map(doc => (
            <DocumentCard key={doc.id} document={doc} />
          ))}
        </div>
      </section>
    </div>
  );
};

export default Home;