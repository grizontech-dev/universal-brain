import { redirect } from 'next/navigation';

export default async function IntegrationsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; status?: string; error?: string }>;
}) {
  const { provider, status, error } = await searchParams;
  let url = '/settings/connections';
  const queryParts = [];
  if (provider) queryParts.push(`provider=${encodeURIComponent(provider)}`);
  if (status) queryParts.push(`status=${encodeURIComponent(status)}`);
  if (error) queryParts.push(`error=${encodeURIComponent(error)}`);
  
  if (queryParts.length > 0) {
    url += `?${queryParts.join('&')}`;
  }
  redirect(url);
}
