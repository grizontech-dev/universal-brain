import { readdir, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const name = process.argv[2];

if (!name) {
  console.error("Usage: pnpm migrate:create <name>");
  process.exit(1);
}

const migrationsDir = fileURLToPath(new URL(".", import.meta.url));

function nextPrefix(existing: string[]) {
  const nums = existing
    .map((f) => f.match(/^(\d{3})_.*\.sql$/)?.[1])
    .filter((v): v is string => Boolean(v))
    .map((s) => Number(s));
  const max = nums.length ? Math.max(...nums) : 0;
  return String(max + 1).padStart(3, "0");
}

const run = async () => {
  const entries = await readdir(migrationsDir);
  const prefix = nextPrefix(entries);
  const safeName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const filename = `${prefix}_${safeName}.sql`;
  const fullPath = path.join(migrationsDir, filename);

  const template = `-- TODO: ${name}\n-- Forward-only migration. Runner handles transaction boundaries.\n`;

  await writeFile(fullPath, template, { flag: "wx" });
  console.info(`Created migration: ${filename}`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
