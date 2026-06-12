import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = process.cwd();
const secretsDir = resolve(rootDir, "secrets");
const privateKeyPath = resolve(secretsDir, "jwt-private.pem");
const publicKeyPath = resolve(secretsDir, "jwt-public.pem");

const force = process.argv.includes("--force");

if (!existsSync(secretsDir)) {
  mkdirSync(secretsDir, { recursive: true });
}

if (!force && (existsSync(privateKeyPath) || existsSync(publicKeyPath))) {
  console.error("JWT key files already exist. Re-run with --force to overwrite.");
  console.error(`- ${privateKeyPath}`);
  console.error(`- ${publicKeyPath}`);
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 4096,
  publicKeyEncoding: {
    type: "spki",
    format: "pem",
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
});

writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });

console.log("JWT keys generated:");
console.log(`- ${privateKeyPath}`);
console.log(`- ${publicKeyPath}`);
