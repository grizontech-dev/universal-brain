'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Bot,
  Loader2,
  Zap,
} from 'lucide-react';
import { useModels } from '@/context/ModelContext';
import type { CatalogueAgent } from '@/lib/chat-contracts';
import {
  catalogueAgentDisplayName,
  catalogueAgentExamplePrompts,
  catalogueAgentShortDescription,
  flattenCatalogueAgents,
} from '@/lib/chat-contracts';

const CARD_GRADIENTS = [
  'from-[#60a5fa]/15 via-[#976df8]/10 to-transparent',
  'from-[#976df8]/15 via-[#f472b6]/10 to-transparent',
  'from-[#34d399]/15 via-[#60a5fa]/10 to-transparent',
  'from-[#fbbf24]/15 via-[#f472b6]/10 to-transparent',
] as const;

const AUTO_MODE_CARD = {
  id: 'auto',
  categoryName: 'Routing',
  name: 'Auto Mode',
  description: 'Backend picks the best agent and model for each message.',
  gradient: 'from-purple-500/20 via-indigo-500/12 to-transparent',
  prompts: [
    { title: 'Brainstorm ideas', prompt: 'Help me brainstorm ideas for a new project' },
    { title: 'Explain a topic', prompt: 'Explain this topic in simple terms' },
    { title: 'Draft a message', prompt: 'Help me draft a clear, professional message' },
  ],
} as const;

interface TaskSelectionViewProps {
  onSelectAction: (text: string, agentSlug: string | null) => void;
}

type AgentSlide =
  | { kind: 'auto' }
  | { kind: 'agent'; agent: CatalogueAgent; categoryName: string };

function AgentSkillCard({
  categoryName,
  name,
  description,
  gradient,
  tags,
  icon,
  prompts,
  fallbackPrompt,
  onPromptClick,
  isActive,
}: {
  categoryName: string;
  name: string;
  description: string;
  gradient: string;
  tags?: string[];
  icon: React.ReactNode;
  prompts: { title: string; prompt: string }[];
  fallbackPrompt?: string;
  onPromptClick: (prompt: string) => void;
  isActive: boolean;
}) {
  return (
    <article
      className={`group relative flex h-full w-full min-h-[240px] flex-col rounded-2xl border bg-surface-1/70 backdrop-blur-sm p-4 transition-all duration-300 ${
        isActive
          ? 'border-accent/40 shadow-[0_10px_40px_rgba(151,109,248,0.18)] -translate-y-0.5'
          : 'border-border-subtle hover:border-accent/30 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(0,0,0,0.4)]'
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br ${gradient} transition-opacity duration-500 ${
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      />
      <div className="relative z-10 flex items-start gap-3">
        <div
          className={`p-2.5 rounded-xl shrink-0 transition-colors ${
            isActive
              ? 'bg-accent/15 text-text-primary'
              : 'bg-surface-3 text-accent group-hover:text-text-primary'
          }`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-bold text-text-faint uppercase tracking-[0.18em] mb-1 truncate">
            {categoryName}
          </p>
          <h3 className="text-sm font-bold text-text-primary group-hover:text-accent transition-colors leading-tight truncate">
            {name}
          </h3>
          {description ? (
            <p className="text-[11.5px] text-text-muted leading-relaxed mt-1.5 line-clamp-2">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      {tags && tags.length > 0 ? (
        <div className="relative z-10 flex flex-wrap gap-1 mt-3">
          {tags.map((tag) => (
            <span
              key={tag}
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-surface-2 text-text-muted border border-border-subtle uppercase tracking-wider"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative z-10 mt-4 space-y-1.5">
        {prompts.length > 0
          ? prompts.map((ex, pIdx) => (
              <button
                key={pIdx}
                type="button"
                onClick={() => onPromptClick(ex.prompt)}
                className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg bg-surface-1 hover:bg-accent/12 text-[11.5px] text-text-muted hover:text-text-primary transition-all border border-border-subtle hover:border-accent/25 group/btn"
              >
                <span className="truncate mr-2 font-medium">{ex.title}</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover/btn:opacity-100 -translate-x-1 group-hover/btn:translate-x-0 transition-all duration-300 text-accent" />
              </button>
            ))
          : fallbackPrompt ? (
              <button
                type="button"
                onClick={() => onPromptClick(fallbackPrompt)}
                className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg bg-surface-1 hover:bg-accent/12 text-[11.5px] text-text-muted hover:text-text-primary transition-all border border-border-subtle hover:border-accent/25 group/btn"
              >
                <span className="truncate mr-2 font-medium">Start with {name}</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover/btn:opacity-100 text-accent" />
              </button>
            ) : null}
      </div>
    </article>
  );
}

export default function TaskSelectionView({ onSelectAction }: TaskSelectionViewProps) {
  const { catalogue, isLoadingModels, error } = useModels();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const catalogueAgents = useMemo(() => flattenCatalogueAgents(catalogue), [catalogue]);

  const slides: AgentSlide[] = useMemo(() => {
    const list: AgentSlide[] = [{ kind: 'auto' }];
    for (const row of catalogueAgents) {
      list.push({ kind: 'agent', agent: row.agent, categoryName: row.categoryName });
    }
    return list;
  }, [catalogueAgents]);

  const slideCount = slides.length;

  const computeScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft;
    setCanScrollLeft(left > 4);
    setCanScrollRight(left < maxScroll - 4);

    const cards = el.querySelectorAll<HTMLElement>('[data-slide-card]');
    const viewportCenter = left + el.clientWidth / 2;
    let closest = 0;
    let minDist = Infinity;
    cards.forEach((child, i) => {
      const childCenter = child.offsetLeft + child.offsetWidth / 2;
      const dist = Math.abs(childCenter - viewportCenter);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    });
    setActiveIndex(closest);
  }, []);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el || slideCount === 0) return;
      const clamped = Math.max(0, Math.min(index, slideCount - 1));
      const card = el.querySelectorAll<HTMLElement>('[data-slide-card]')[clamped];
      if (!card) return;
      const target = card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2;
      el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
      setActiveIndex(clamped);
    },
    [slideCount],
  );

  const scrollByDirection = useCallback(
    (direction: 1 | -1) => {
      scrollToIndex(activeIndex + direction);
    },
    [activeIndex, scrollToIndex],
  );

  useLayoutEffect(() => {
    computeScrollState();
  }, [computeScrollState, slideCount]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onResize = () => computeScrollState();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [computeScrollState]);

  const showSlider = slideCount > 0;
  const showCatalogueLoading = isLoadingModels && catalogueAgents.length === 0;

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-6xl mx-auto animate-in fade-in duration-700">
      <div className="text-center mb-6 lg:mb-8 px-4 w-full">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-2 border border-border-subtle mb-3">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span className="text-[11px] font-bold text-text-muted uppercase tracking-widest">
            Powered by Grizon AI
          </span>
        </div>
        <h1 className="text-2xl lg:text-3xl font-bold text-text-primary mb-1.5 tracking-tight">
          What are we{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-400">
            building
          </span>{' '}
          today?
        </h1>
        <p className="text-text-muted text-[11px] lg:text-xs max-w-lg mx-auto leading-relaxed">
          Choose a skill or start typing.
        </p>
      </div>

      <div className="w-full">
        {showCatalogueLoading ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-text-muted">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
            <span className="text-xs font-medium">Loading more skills…</span>
          </div>
        ) : null}

        {!showSlider && !showCatalogueLoading ? (
          <div className="rounded-2xl border border-border-subtle bg-surface-1 px-6 py-10 text-center mx-4">
            <p className="text-sm text-text-muted">
              {error ? 'Could not load skills. Try refreshing the page.' : 'No agents available yet.'}
            </p>
          </div>
        ) : null}

        {showSlider ? (
          <div className="w-full">
            <div className="relative w-full">
              <div
                ref={scrollRef}
                onScroll={computeScrollState}
                className="scrollbar-none flex w-full gap-4 py-5 pl-3 pr-3 sm:pl-14 sm:pr-14 overflow-x-auto snap-x snap-proximity scroll-smooth overscroll-x-contain"
              >
                {slides.map((slide, idx) => {
                  const isActive = idx === activeIndex;
                  if (slide.kind === 'auto') {
                    return (
                      <div
                        key="auto"
                        data-slide-card
                        className="shrink-0 snap-start w-[280px] sm:w-[300px]"
                      >
                        <AgentSkillCard
                          categoryName={AUTO_MODE_CARD.categoryName}
                          name={AUTO_MODE_CARD.name}
                          description={AUTO_MODE_CARD.description}
                          gradient={AUTO_MODE_CARD.gradient}
                          icon={<Zap className="w-5 h-5 text-accent" fill="currentColor" />}
                          prompts={[...AUTO_MODE_CARD.prompts]}
                          isActive={isActive}
                          onPromptClick={(prompt) => onSelectAction(prompt, null)}
                        />
                      </div>
                    );
                  }

                  const { agent, categoryName } = slide;
                  const name = catalogueAgentDisplayName(agent);
                  const description = catalogueAgentShortDescription(agent);
                  const prompts = catalogueAgentExamplePrompts(agent);
                  const gradient = CARD_GRADIENTS[(idx - 1) % CARD_GRADIENTS.length];
                  const tags = (agent.tags ?? []).slice(0, 3);

                  return (
                    <div
                      key={agent.slug}
                      data-slide-card
                      className="shrink-0 snap-start w-[280px] sm:w-[300px]"
                    >
                      <AgentSkillCard
                        categoryName={categoryName}
                        name={name}
                        description={description}
                        gradient={gradient}
                        tags={tags}
                        icon={<Bot className="w-5 h-5" />}
                        prompts={prompts}
                        fallbackPrompt={`Help me with ${name.toLowerCase()}`}
                        isActive={isActive}
                        onPromptClick={(prompt) => onSelectAction(prompt, agent.slug)}
                      />
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => scrollByDirection(-1)}
                disabled={!canScrollLeft}
                aria-label="Previous skill"
                className="hidden sm:flex absolute left-1 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-surface-2/95 backdrop-blur border border-border-default text-text-secondary hover:text-text-primary hover:border-accent/40 hover:bg-surface-3 disabled:opacity-0 disabled:pointer-events-none items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.4)] transition-all"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => scrollByDirection(1)}
                disabled={!canScrollRight}
                aria-label="Next skill"
                className="hidden sm:flex absolute right-1 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-surface-2/95 backdrop-blur border border-border-default text-text-secondary hover:text-text-primary hover:border-accent/40 hover:bg-surface-3 disabled:opacity-0 disabled:pointer-events-none items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.4)] transition-all"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {slideCount > 1 ? (
              <div className="mt-3 flex justify-center gap-1.5 px-4">
                {slides.map((slide, i) => (
                  <button
                    key={slide.kind === 'auto' ? 'auto' : slide.agent.slug}
                    type="button"
                    aria-label={
                      slide.kind === 'auto'
                        ? 'Go to Auto Mode'
                        : `Go to ${catalogueAgentDisplayName(slide.agent)}`
                    }
                    onClick={() => scrollToIndex(i)}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === activeIndex
                        ? 'w-6 bg-gradient-to-r from-[#976df8] to-[#60a5fa]'
                        : 'w-1.5 bg-surface-3 hover:bg-surface-4'
                    }`}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
