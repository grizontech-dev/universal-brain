import type { Logger } from "pino";
import type { AccessTokenDecoded, AuthActor, AuthSession, AuthUser, Platform, UserRole, UserStatus } from "./auth.js";
import type { WalletHold } from "./wallet.js";

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      // Module 1 attaches identity before downstream middleware runs.
      platform?: Platform;
      user?: AuthUser;
      session?: AuthSession;
      token?: Pick<AccessTokenDecoded, "jti" | "exp"> & Partial<AccessTokenDecoded>;
      actor?: AuthActor;

      // Backwards-compat: some existing code may refer to these directly.
      // (These are intentionally redundant with `user.role`/`user.status`.)
      role?: UserRole;
      status?: UserStatus;
      creditEstimate?: {
        inputTokens: number;
        outputTokens: number;
        agentSlug: string;
      };
      wallet?: WalletHold;
    }
  }
}

export {};
