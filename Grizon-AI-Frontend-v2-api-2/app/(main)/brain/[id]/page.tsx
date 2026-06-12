'use client';

import { Suspense } from 'react';
import BrainMessages from '../../../../brain/components/BrainMessages';
import { BrainWebContainerProvider } from '../../../../brain/context/BrainWebContainerContext';

function BrainFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0a0a0a] text-white">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#976df8] border-t-transparent" />
    </div>
  );
}

export default function BrainConversationPage() {
  return (
    <Suspense fallback={<BrainFallback />}>
      <div className="flex-1 h-full w-full overflow-hidden relative bg-[#0a0a0a]">
        <BrainWebContainerProvider>
          <BrainMessages />
        </BrainWebContainerProvider>
      </div>
    </Suspense>
  );
}
