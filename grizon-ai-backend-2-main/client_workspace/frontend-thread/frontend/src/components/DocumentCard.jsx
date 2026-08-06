import React from 'react';

export default function DocumentCard({ document }) {
  if (!document) return null;
  return (
    <div className="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-md hover:border-blue-500 transition-all">
      <h3 className="text-lg font-bold text-white mb-2">{document.title || document.name || 'Untitled Document'}</h3>
      <p className="text-sm text-gray-400 mb-4">{document.description || 'Document overview and summary details.'}</p>
      {document.url && (
        <a
          href={document.url}
          target="_blank"
          rel="noreferrer"
          className="inline-block bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
        >
          View Document
        </a>
      )}
    </div>
  );
}
