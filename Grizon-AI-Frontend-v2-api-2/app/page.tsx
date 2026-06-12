'use client';

import React, { useEffect } from 'react';
import Header from '@/components/landing/Header';
import Hero from '@/components/landing/Hero';
import Footer from '@/components/landing/Footer';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function Home() {
  const router = useRouter();
  const { openAuthModal, user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user?.email_verified_at) {
      router.push('/chat');
    }
  }, [user, isLoading, router]);

  const handleLogin = () => {
    openAuthModal('signin-email');
  };

  const handleSignup = () => {
    openAuthModal('register');
  };

  const handleSendMessage = (message: string) => {
    if (isLoading) return false;
    if (!user) {
      openAuthModal('signin-email');
      return false;
    }
    if (!user.email_verified_at) {
      openAuthModal('verify-email');
      return false;
    }
    // Navigate to chat with the initial message
    router.push(`/chat?initialMessage=${encodeURIComponent(message)}`);
    return true;
  };

  return (
    <div className="flex flex-col min-h-screen bg-app text-text-primary font-sans overflow-y-auto">
      <Header onLogin={handleLogin} onSignup={handleSignup} />

      <Hero onSendMessage={handleSendMessage} />

      <Footer />
    </div>
  );
}
