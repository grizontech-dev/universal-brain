import * as argon2 from "argon2";

import { authConfig } from "../config/auth.js";

export type PasswordHashParams = {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  hashLength: number;
};

const params: PasswordHashParams = {
  memoryCost: authConfig.password.memoryCost,
  timeCost: authConfig.password.timeCost,
  parallelism: authConfig.password.parallelism,
  hashLength: authConfig.password.hashLength,
};

export const passwordService = {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: params.memoryCost,
      timeCost: params.timeCost,
      parallelism: params.parallelism,
      hashLength: params.hashLength,
    });
  },

  async verify(plain: string, hash: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  },

  needsRehash(hash: string): boolean {
    // Argon2 encoded format:
    // $argon2id$v=19$m=19456,t=2,p=1...$<salt>$<hash>
    const match = hash.match(/\$m=(\d+),t=(\d+),p=(\d+)(?:,l=(\d+))?/);
    if (!match) return true;
    const memoryCost = Number(match[1]);
    const timeCost = Number(match[2]);
    const parallelism = Number(match[3]);
    const l = match[4] ? Number(match[4]) : null;

    if (memoryCost !== params.memoryCost) return true;
    if (timeCost !== params.timeCost) return true;
    if (parallelism !== params.parallelism) return true;
    if (l !== null && l !== params.hashLength) return true;
    return false;
  },
};

