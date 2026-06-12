'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { fetchCatalogue, fetchSubscription } from '@/lib/chat-rest-api';
import type { CatalogueResponse, PlanSnapshot } from '@/lib/chat-contracts';
import { ApiError } from '@/lib/auth-api';

export interface UIModel {
  id: string;
  name: string;
  category: string;
  accessible: boolean;
  provider: string;
  isAuto?: boolean;
  isActive?: boolean;
  requiredPlan?: string;
  description?: string;
  creditCost?: number;
  maxContextWindow?: number;
}

interface ModelContextType {
  availableModels: UIModel[];
  catalogue: CatalogueResponse | null;
  planSnapshot: PlanSnapshot | null;
  featureFlags: Record<string, boolean>;
  modelPickerEnabled: boolean;
  fileUploadEnabled: boolean;
  selectedModel: UIModel | null;
  selectedAgentSlug: string | null;
  isLoadingModels: boolean;
  error: string | null;
  setSelectedModel: (model: UIModel) => void;
  setSelectedAgentSlug: (slug: string | null) => void;
  refreshModels: () => Promise<void>;
}

const ModelContext = createContext<ModelContextType | undefined>(undefined);

const AUTO_MODEL: UIModel = {
  id: 'auto',
  name: 'Auto',
  category: 'ROUTING',
  description: 'Smart routing picks the best agent and model.',
  isAuto: true,
  accessible: true,
  isActive: true,
  provider: 'Grizon',
  creditCost: 0,
  maxContextWindow: 0,
};

export const ModelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [catalogue, setCatalogue] = useState<CatalogueResponse | null>(null);
  const [planSnapshot, setPlanSnapshot] = useState<PlanSnapshot | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModelInternal] = useState<UIModel | null>(AUTO_MODEL);
  const [selectedAgentSlug, setSelectedAgentSlug] = useState<string | null>(null);

  const featureFlags = useMemo(() => planSnapshot?.featureFlags ?? {}, [planSnapshot]);
  const modelPickerEnabled = Boolean(featureFlags.modelPicker);
  const fileUploadEnabled = Boolean(featureFlags.fileUpload);

  const availableModels = useMemo(() => {
    const models: UIModel[] = [AUTO_MODEL];
    const access = planSnapshot?.modelAccess ?? [];
    for (const id of access) {
      models.push({
        id,
        name: id,
        category: 'Plan',
        accessible: true,
        isActive: true,
        provider: 'Plan',
        description: 'Pinned model override',
        creditCost: 0,
        maxContextWindow: 0,
      });
    }
    return models;
  }, [planSnapshot?.modelAccess]);

  const refreshModels = useCallback(async () => {
    if (!isAuthenticated) {
      setCatalogue(null);
      setPlanSnapshot(null);
      return;
    }
    setIsLoadingModels(true);
    setError(null);
    try {
      const [cat, sub] = await Promise.all([fetchCatalogue(), fetchSubscription()]);
      setCatalogue(cat);
      setPlanSnapshot(sub.subscription.planSnapshot);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to load catalogue';
      setError(msg);
    } finally {
      setIsLoadingModels(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  const setSelectedModel = useCallback((model: UIModel) => {
    setSelectedModelInternal(model);
    if (typeof window !== 'undefined') {
      localStorage.setItem('selected_model_id', model.id);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('selected_model_id');
    if (!saved || saved === 'auto') return;
    setSelectedModelInternal({
      ...AUTO_MODEL,
      id: saved,
      name: saved,
      isAuto: false,
    });
  }, []);

  const value = useMemo(
    () => ({
      availableModels,
      catalogue,
      planSnapshot,
      featureFlags,
      modelPickerEnabled,
      fileUploadEnabled,
      selectedModel,
      selectedAgentSlug,
      isLoadingModels,
      error,
      setSelectedModel,
      setSelectedAgentSlug,
      refreshModels,
    }),
    [
      availableModels,
      catalogue,
      planSnapshot,
      featureFlags,
      modelPickerEnabled,
      fileUploadEnabled,
      selectedModel,
      selectedAgentSlug,
      isLoadingModels,
      error,
      setSelectedModel,
      setSelectedAgentSlug,
      refreshModels,
    ],
  );

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
};

export const useModels = () => {
  const context = useContext(ModelContext);
  if (context === undefined) {
    throw new Error('useModels must be used within a ModelProvider');
  }
  return context;
};
