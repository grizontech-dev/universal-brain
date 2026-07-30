'use client';

import { Suspense } from 'react';
import BrainMessages from '../../../brain/components/BrainMessages';
import { BrainWebContainerProvider } from '../../../brain/context/BrainWebContainerContext';

function BrainFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-app text-text-primary">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
    </div>
  );
}

export default function BrainPage() {
  return (
    <Suspense fallback={<BrainFallback />}>
      <div className="flex-1 h-full w-full overflow-hidden relative bg-app text-text-primary">
        <BrainWebContainerProvider>
          <BrainMessages />
        </BrainWebContainerProvider>
      </div>
    </Suspense>
  );
}

