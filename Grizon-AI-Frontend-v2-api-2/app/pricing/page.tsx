import PricingCards from "@/components/pricing/PricingCards";
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pricing | Grizon AI',
  description: 'Choose an affordable plan for engaging your audience.',
}

export default function PricingPage() {
  return (
    <main>
      <PricingCards />
    </main>
  );
}
