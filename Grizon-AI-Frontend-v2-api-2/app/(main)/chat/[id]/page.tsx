import { redirect } from 'next/navigation';

/**
 * Existing conversation route — redirects to /brain
 */
export default function ChatIdPage() {
  redirect('/brain');
}

