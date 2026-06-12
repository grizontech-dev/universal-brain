'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface ThreadListContextValue {
  threadListOpen: boolean;
  setThreadListOpen: (open: boolean) => void;
  toggleThreadList: () => void;
}

const ThreadListContext = createContext<ThreadListContextValue | undefined>(
  undefined,
);

export function ThreadListProvider({ children }: { children: React.ReactNode }) {
  const [threadListOpen, setThreadListOpen] = useState(true);

  const toggleThreadList = useCallback(() => {
    setThreadListOpen((v) => !v);
  }, []);

  const value = useMemo(
    () => ({
      threadListOpen,
      setThreadListOpen,
      toggleThreadList,
    }),
    [threadListOpen, toggleThreadList],
  );

  return (
    <ThreadListContext.Provider value={value}>
      {children}
    </ThreadListContext.Provider>
  );
}

export function useThreadList() {
  const ctx = useContext(ThreadListContext);
  if (!ctx) {
    throw new Error('useThreadList must be used within ThreadListProvider');
  }
  return ctx;
}
