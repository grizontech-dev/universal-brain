import React, { useState, useRef } from 'react';
import Suggestions from './Suggestions';

interface HeroProps {
  onSendMessage: (message: string) => boolean | void;
}

export default function Hero({ onSendMessage }: HeroProps) {
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!inputValue.trim()) return;
    const sent = onSendMessage(inputValue);

    // If the message wasn't sent (e.g. auth required), don't clear the input
    if (sent === false) return;

    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const fillSuggestion = (text: string) => {
    setInputValue(text);
    if (textareaRef.current) {
      textareaRef.current.value = text;
      textareaRef.current.focus();
      // Trigger resize
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-10 sm:py-16 relative w-full">
      <div className="w-full max-w-[680px] flex flex-col items-center">
        {/* Logo Section */}
        <div className="relative mb-8 animate-fade-in">
          <div
            className="w-16 h-16 sm:w-20 sm:h-20 transition-transform hover:scale-105 duration-300"
          >
            <img
              src="/Logo.svg"
              alt="Grizon"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        {/* Welcome Text */}
        <h1 className="text-[26px] sm:text-[32px] font-bold text-text-primary tracking-tight mb-3 animate-fade-in animate-delay-1 text-center font-sans px-4">
          Welcome to Grizon AI
        </h1>
        <p className="text-[14px] sm:text-[16px] text-text-muted font-light mb-12 animate-fade-in animate-delay-2 text-center max-w-[280px] sm:max-w-md font-sans leading-relaxed">
          Your intelligent assistant for ideas, code, analysis, and more.
        </p>

        {/* Chat Input Container */}
        <div className="w-full animate-fade-in animate-delay-2 relative z-10">
          <div className="glass-container">
            {/* Model Selector Row */}
            <div className="flex items-center justify-between px-4 pt-2.5 pb-0">
              <button className="flex items-center gap-2 px-3 py-1 rounded-md text-xs font-medium text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors duration-150">
                {/* Lightning Icon SVG */}
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span
                  style={{ fontFamily: 'var(--font-inter), Inter, sans-serif' }}
                >
                  Opus 4.5
                </span>
                {/* Chevron Down Icon SVG */}
                <svg
                  className="w-3 h-3 opacity-50"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>

            {/* Input Row */}
            <div className="flex items-end gap-2 px-4 py-3">
              {/* Attachment Button */}
              <input
                type="file"
                className="hidden"
                id="hero-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.name.toLowerCase().endsWith('.zip')) {
                      alert(`ZIP files (${file.name}) are not allowed for upload.`);
                      e.target.value = '';
                      return;
                    }
                    // Placeholder for actual upload or carrying over to chat
                    console.log('File selected on hero:', file.name);
                  }
                }}
              />
              <button
                onClick={() => document.getElementById('hero-file-input')?.click()}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-faint hover:text-text-muted hover:bg-surface-3 transition-all shrink-0 mb-0.5"
                aria-label="Attach file"
              >
                <svg
                  className="w-[18px] h-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>

              {/* Textarea Input */}
              <textarea
                id="chatInput"
                ref={textareaRef}
                rows={1}
                placeholder="Message Grizon AI..."
                className="flex-1 bg-transparent text-[14px] text-text-primary placeholder:text-text-faint outline-none leading-relaxed py-1 min-h-[24px] resize-none max-h-[160px] font-sans"
                style={{
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                  fieldSizing: 'content' as any,
                  scrollbarWidth: 'thin',
                }}
                value={inputValue}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
              />

              {/* Send Button */}
              <button
                onClick={handleSend}
                disabled={!inputValue.trim()}
                aria-label="Send message"
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center bg-accent hover:bg-accent-hover transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                style={{
                  boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)',
                }}
              >
                {/* Send Arrow Icon SVG */}
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 2L11 13" />
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Suggestions Grid */}
        <Suggestions onSelect={fillSuggestion} />
      </div>

      {/* Logo Glow Pseudo-element Style */}
      <style jsx>{`
        @keyframes fadeSlideUp {
          from {
            opacity: 0;
            transform: translateY(15px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fadeSlideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .animate-delay-1 {
          animation-delay: 0.1s;
        }
        .animate-delay-2 {
          animation-delay: 0.2s;
        }
      `}</style>
    </main>
  );
}
