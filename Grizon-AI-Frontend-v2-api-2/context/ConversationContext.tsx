'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { useAuth } from './AuthContext';
import type { ApiConversation, ApiMessage } from '@/lib/chat-contracts';
import {
  listConversations,
  createConversation,
  getConversation,
  patchConversation,
  deleteConversation as archiveConversationRequest,
  listMessages,
} from '@/lib/chat-rest-api';
import { ApiError } from '@/lib/auth-api';

/** Thread list + navigation shape used by `ThreadPanel` */
export interface ConversationListItem {
  id: string;
  userId: string;
  title: string;
  isArchived: boolean;
  isPinned?: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
}

function mapApiToListItem(c: ApiConversation): ConversationListItem {
  return {
    id: c.id,
    userId: c.userId,
    title: c.title,
    isArchived: c.status === 'archived',
    isPinned: Boolean(c.pinnedAt),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    lastMessageAt: c.lastMessageAt,
  };
}

interface ConversationContextType {
  conversations: ConversationListItem[];
  currentConversationId: string | null;
  /** Full thread + messages for active chat UI */
  activeMessages: ApiMessage[];
  activeConversation: ApiConversation | null;
  isLoading: boolean;
  isLoadingMessages: boolean;
  error: string | null;
  fetchConversations: () => Promise<void>;
  selectConversation: (id: string | null) => void;
  deleteConversation: (id: string) => Promise<void>;
  addConversation: (conversation: ConversationListItem) => void;
  createConversationAndSelect: (opts?: {
    defaultAgentSlug?: string | null;
    defaultModelId?: string | null;
  }) => Promise<ApiConversation>;
  updateConversationTitle: (id: string, title: string) => Promise<void>;
  pinConversation: (id: string, isPinned: boolean) => Promise<void>;
  refreshConversation: (id: string) => Promise<void>;
  refreshAfterStream: (id: string) => Promise<void>;
  touchConversation: (id: string) => void;
  loadMessagesFor: (id: string) => Promise<void>;
  setConversationId: (id: string | null) => void;
}

const ConversationContext = createContext<ConversationContextType | undefined>(undefined);

export const ConversationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [activeMessages, setActiveMessages] = useState<ApiMessage[]>([]);
  const [activeConversation, setActiveConversation] = useState<ApiConversation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesCacheRef = useRef<Map<string, { conversation: ApiConversation; messages: ApiMessage[] }>>(new Map());

  const parseConversationIdFromPath = useCallback((path: string | null): string | null => {
    if (!path) return null;
    if (path === '/brain' || path === '/chat') return null;
    const match = path.match(/\/(?:chat|brain)\/([^/]+)/);
    if (!match?.[1] || match[1] === 'new') return null;
    return match[1].replace(/[^a-zA-Z0-9_-].*$/, '');
  }, []);

  useEffect(() => {
    const fromPath = parseConversationIdFromPath(pathname);
    if (fromPath) {
      setCurrentConversationId(fromPath);
      return;
    }
    if (params?.id) {
      const cleanId = (params.id as string).replace(/[^a-zA-Z0-9_-].*$/, '');
      setCurrentConversationId(cleanId);
      return;
    }
    setCurrentConversationId(null);
  }, [pathname, params?.id, parseConversationIdFromPath]);

  const fetchConversations = useCallback(async () => {
    if (!isAuthenticated) {
      setConversations([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const items = await listConversations({ limit: 50 });
      setConversations(items.map(mapApiToListItem));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to load conversations';
      setError(msg);
      setConversations([]);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (user?.id && isAuthenticated) {
      void fetchConversations();
    } else {
      setConversations([]);
      setActiveMessages([]);
      setActiveConversation(null);
    }
  }, [user?.id, isAuthenticated, fetchConversations]);

  const loadMessagesFor = useCallback(async (id: string) => {
    const cached = messagesCacheRef.current.get(id);
    if (cached) {
      setActiveConversation(cached.conversation);
      setActiveMessages(cached.messages);
      setIsLoadingMessages(false);
    } else {
      setActiveMessages([]);
      setActiveConversation(null);
      setIsLoadingMessages(true);
    }
    setError(null);
    try {
      const data = await getConversation(id);
      messagesCacheRef.current.set(id, {
        conversation: data.conversation,
        messages: data.messages ?? [],
      });
      setActiveConversation(data.conversation);
      setActiveMessages(data.messages ?? []);
      setConversations((prev) => {
        const mapped = mapApiToListItem(data.conversation);
        const existing = prev.find((c) => c.id === mapped.id);
        const merged = existing ? { ...mapped, isPinned: existing.isPinned } : mapped;
        const rest = prev.filter((c) => c.id !== mapped.id);
        return [merged, ...rest];
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to load conversation';
      if (!cached) setError(msg);
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (currentConversationId && isAuthenticated) {
      void loadMessagesFor(currentConversationId);
    } else {
      setActiveMessages([]);
      setActiveConversation(null);
    }
  }, [currentConversationId, isAuthenticated, loadMessagesFor]);

  const selectConversation = useCallback(
    (id: string | null) => {
      // Use a more robust check for the current module
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
      const isBrain = currentPath.startsWith('/brain');
      const prefix = isBrain ? '/brain' : '/chat';
      
      if (id) {
        const target = `${prefix}/${id}`;
        if (currentPath !== target) {
          router.push(target);
        }
      } else {
        if (currentPath !== prefix) {
          router.push(prefix);
        }
      }
    },
    [router],
  );

  const setConversationId = useCallback(
    (id: string | null) => {
      setCurrentConversationId(id);
    },
    []
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await archiveConversationRequest(id);
        messagesCacheRef.current.delete(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (currentConversationId === id) {
          const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
          const isBrain = currentPath.startsWith('/brain');
          router.push(isBrain ? '/brain' : '/chat');
        }
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'Failed to delete';
        setError(msg);
      }
    },
    [currentConversationId, router],
  );

  const addConversation = useCallback(
    (conversation: ConversationListItem) => {
      setConversations((prev) => [conversation, ...prev.filter((c) => c.id !== conversation.id)]);
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
      const isBrain = currentPath.startsWith('/brain');
      router.push(isBrain ? `/brain/${conversation.id}` : `/chat/${conversation.id}`);
    },
    [router],
  );

  const createConversationAndSelect = useCallback(
    async (opts?: { defaultAgentSlug?: string | null; defaultModelId?: string | null }) => {
      const { conversation } = await createConversation({
        defaultAgentSlug: opts?.defaultAgentSlug,
        defaultModelId: opts?.defaultModelId,
      });
      const item = mapApiToListItem(conversation);
      setConversations((prev) => [item, ...prev.filter((c) => c.id !== item.id)]);
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
      const isBrain = currentPath.startsWith('/brain');
      router.push(isBrain ? `/brain/${conversation.id}` : `/chat/${conversation.id}`);
      setActiveConversation(conversation);
      setActiveMessages([]);
      return conversation;
    },
    [router],
  );

  const updateConversationTitle = useCallback(async (id: string, title: string) => {
    try {
      const { conversation } = await patchConversation(id, { title });
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...mapApiToListItem(conversation), isPinned: c.isPinned } : c)),
      );
      if (activeConversation?.id === id) {
        setActiveConversation(conversation);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Rename failed';
      setError(msg);
    }
  }, [activeConversation?.id]);

  const pinConversation = useCallback(async (id: string, isPinned: boolean) => {
    try {
      const { conversation } = await patchConversation(id, { pinned: isPinned });
      setConversations((prev) =>
        prev
          .map((c) => (c.id === id ? mapApiToListItem(conversation) : c))
          .sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            const ta = new Date(b.lastMessageAt || b.updatedAt || b.createdAt).getTime();
            const tb = new Date(a.lastMessageAt || a.updatedAt || a.createdAt).getTime();
            return ta - tb;
          }),
      );
      if (activeConversation?.id === id) {
        setActiveConversation(conversation);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Pin failed';
      setError(msg);
    }
  }, [activeConversation?.id]);

  const refreshConversation = useCallback(
    async (id: string) => {
      await loadMessagesFor(id);
    },
    [loadMessagesFor],
  );

  const refreshAfterStream = useCallback(
    async (id: string) => {
      await loadMessagesFor(id);
      await fetchConversations();
    },
    [loadMessagesFor, fetchConversations],
  );

  const touchConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const index = prev.findIndex((c) => c.id === id);
      if (index === -1) return prev;
      const updated = { ...prev[index], updatedAt: new Date().toISOString() };
      const filtered = prev.filter((c) => c.id !== id);
      return [updated, ...filtered];
    });
  }, []);

  return (
    <ConversationContext.Provider
      value={{
        conversations,
        currentConversationId,
        activeMessages,
        activeConversation,
        isLoading,
        isLoadingMessages,
        error,
        fetchConversations,
        selectConversation,
        deleteConversation,
        addConversation,
        createConversationAndSelect,
        updateConversationTitle,
        pinConversation,
        refreshConversation,
        refreshAfterStream,
        touchConversation,
        loadMessagesFor,
        setConversationId,
      }}
    >
      {children}
    </ConversationContext.Provider>
  );
};

export const useConversations = () => {
  const context = useContext(ConversationContext);
  if (context === undefined) {
    throw new Error('useConversations must be used within a ConversationProvider');
  }
  return context;
};

/** Paginated older messages — optional cursor from future API meta */
export async function fetchMoreMessages(conversationId: string, cursor: string, limit = 25) {
  return listMessages(conversationId, { cursor, limit });
}
