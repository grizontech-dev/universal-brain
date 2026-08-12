import { redirect } from 'next/navigation';

/**
 * New chat route — redirects to /brain
 */
export default function ChatPage() {
  redirect('/brain');
}

