import React from 'react';
import Image from 'next/image';
import { useAuth } from '../../context/AuthContext';

interface HeaderProps {
  onLogin: () => void;
  onSignup: () => void;
}

export default function Header({ onLogin, onSignup }: HeaderProps) {
  const { user, logout } = useAuth();

  return (
    <header className="flex items-center justify-between px-6 py-3 shrink-0 border-b border-border-subtle sticky top-0 bg-app/80 backdrop-blur-md z-50 w-full">
      {/* Left: Logo + Brand */}
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 cursor-pointer shrink-0"
          title="Grizon AI"
        >
          <img
            src="/Logo.svg"
            alt="Grizon"
            className="w-full h-full object-contain"
          />
        </div>
        <span className="text-[14px] font-semibold text-text-secondary tracking-tight hidden min-[450px]:block">
          Grizon AI
        </span>
      </div>

      {/* Right: Login, Sign Up, Help */}
      <div className="flex items-center gap-1">
        {user ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold overflow-hidden border border-accent/30">
                {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
              </div>
              <span className="text-[13px] text-text-secondary font-medium hidden sm:block">
                {user.name || 'User'}
              </span>
            </div>
            <button
              className="header-btn text-text-muted hover:text-text-secondary hover:bg-surface-2 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all"
              onClick={logout}
            >
              Log out
            </button>
          </div>
        ) : (
          <>
            <button
              className="header-btn text-text-muted hover:text-text-secondary hover:bg-surface-2 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all"
              onClick={onLogin}
            >
              Log in
            </button>
            <button
              className="header-btn text-text-muted hover:text-text-secondary hover:bg-surface-2 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all"
              onClick={onSignup}
            >
              Sign up
            </button>
          </>
        )}
        <button
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-faint hover:text-text-muted hover:bg-surface-2 transition-all ml-1"
          aria-label="Help"
          title="Help"
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
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
      </div>
    </header>
  );
}
