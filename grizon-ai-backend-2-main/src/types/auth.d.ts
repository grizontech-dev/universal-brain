export type UserRole = "user" | "admin" | "superadmin";
export type UserStatus = "active" | "banned" | "suspended";
export type Platform = "web" | "admin" | "mobile-ios" | "mobile-android";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus; // banned never reaches handlers that require auth
  plan_id: string | null; // populated by Module 2; null in Module 1
  email_verified_at: string | null;
  mfa_enabled: boolean; // reserved for Phase 2
  has_password: boolean;
  linked_providers: Array<{ provider: "google"; provider_email: string; linked_at: string }>;
};

export type AuthSession = {
  id: string;
  platform: Platform;
  device_name: string;
  fingerprint: string;
  issued_at: string;
  expires_at: string;
  last_used_at?: string | null;
};

export type AccessTokenDecoded = {
  sub: string;
  jti: string;
  exp: number; // epoch seconds
  iat: number; // epoch seconds
  role: UserRole;
  plan_id: string | null;
  aud: Platform;
  iss: string;
  act?: { sub: string }; // impersonation: { sub: <admin_id> }
};

export type AuthActor = { id: string };

export type AuthReqContext = {
  user?: AuthUser;
  session?: AuthSession;
  token?: AccessTokenDecoded;
  actor?: AuthActor;
};

