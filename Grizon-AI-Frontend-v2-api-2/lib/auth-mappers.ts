import type { AuthUserProfile } from './auth-api';
import type { User } from './types';

export function mapProfileToUser(p: AuthUserProfile): User {
  return {
    id: p.id,
    email: p.email,
    name: p.name,
    bio: p.bio ?? undefined,
    avatar: p.avatar_url ?? undefined,
    avatar_url: p.avatar_url,
    locale: p.locale,
    timezone: p.timezone,
    mfa_enabled: p.mfa_enabled,
    has_password: p.has_password,
    linked_providers: p.linked_providers,
    email_verified_at: p.email_verified_at,
    role: p.role,
    status: p.status,
    subscription: 'free',
    subscriptionStatus: 'N/A',
    createdAt: p.created_at,
    updatedAt: p.last_login_at ?? undefined,
  };
}
