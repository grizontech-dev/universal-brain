import React from 'react';

export default function ProductCard({ product }) {
  if (!product) return null;
  return (
    <div className="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-md hover:border-purple-500 transition-all flex flex-col justify-between">
      <div>
        <h3 className="text-lg font-bold text-white mb-2">{product.name || product.title || 'Product Item'}</h3>
        <p className="text-sm text-gray-400 mb-4">{product.description || 'High quality product feature details.'}</p>
      </div>
      <div className="flex items-center justify-between mt-auto">
        <span className="text-xl font-extrabold text-green-400">${product.price || '49.99'}</span>
        <button className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
          Add to Cart
        </button>
      </div>
    </div>
  );
}
