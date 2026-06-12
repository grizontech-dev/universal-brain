import { EventEmitter } from "events";

export type AuthEvent =
  | { type: "auth.registered"; payload: { userId: string; email: string; platform: string; ip: string; via: "password" | "google" } }
  | { type: "auth.login"; payload: { userId: string; sessionId: string; platform: string; deviceName: string; ip: string; fingerprint: string; isNewDevice: boolean; via: "password" | "google" } }
  | { type: "auth.google_linked"; payload: { userId: string; providerEmail: string } }
  | { type: "auth.google_unlinked"; payload: { userId: string } }
  | { type: "auth.email_check"; payload: { emailHash: string; ip: string; suggestedAction: string } }
  | { type: "auth.login_new_device"; payload: { userId: string; sessionId: string; platform: string; deviceName: string; ip: string } }
  | { type: "auth.logout"; payload: { userId: string; sessionId: string } }
  | { type: "auth.logout_all"; payload: { userId: string; count: number } }
  | { type: "auth.profile_updated"; payload: { userId: string; fields: string[] } }
  | { type: "auth.password_changed"; payload: { userId: string; byActor?: string } }
  | { type: "auth.banned"; payload: { userId: string; actorId: string; reason: string } }
  | { type: "auth.unbanned"; payload: { userId: string; actorId: string } }
  | { type: "auth.impersonated"; payload: { targetUserId: string; actorId: string; reason: string; jti: string } };

class TypedEmitter extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}

export const authEvents = new TypedEmitter();

