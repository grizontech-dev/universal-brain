'use client';

import React from 'react';

interface MessageSkeletonProps {
  count?: number;
}

export default function MessageSkeleton({ count = 3 }: MessageSkeletonProps) {
  return (
    <div className="space-y-6 py-4 animate-in fade-in duration-200">
      {Array.from({ length: count }).map((_, i) => {
        const isUser = i % 2 === 1;
        return (
          <div
            key={i}
            className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}
          >
            <div className="h-3.5 w-24 rounded-md bg-surface-2 animate-pulse" />
            <div
              className={`max-w-[80%] rounded-2xl bg-surface-2 border border-border-subtle px-4 py-3 space-y-2 ${
                isUser ? 'rounded-br-md' : 'rounded-bl-md'
              }`}
            >
              <div className="h-3 w-64 max-w-full rounded bg-surface-3 animate-pulse" />
              <div className="h-3 w-48 max-w-full rounded bg-surface-3 animate-pulse" />
              {!isUser && (
                <div className="h-3 w-56 max-w-full rounded bg-surface-2 animate-pulse" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
