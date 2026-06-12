# Layer 3 Task 3 — File Ingestion, Artifact Storage & Subagents
## Implementation Specification

> **Status:** Ready for Implementation
> **Depends on:** Task 1 (`LAYER3_TASK1`) for `api_calls` table; Task 2 (`LAYER3_TASK2`) for Qdrant (`src/lib/qdrant.ts`) and embedding helper
> **Modules:** M19 (Artifact Service & Storage), M20 (File Ingestion Pipeline), M22 (Subagents & Isolation)
> **Last Updated:** 2026-05-08

---

## 1. Source Priority

1. `docs/LAYER3_AGENT_EXECUTION.md` §10 (M19 Artifacts), §11 (M20 Files), §13 (M22 Subagents)
2. `docs/LAYER3_RUNTIME_PROVIDER_PROMPT_REFERENCE.md` §7 (subagent policy)
3. `docs/AGENT_LLM_CATALOGUE.md` — system model config for subagent tier resolution
4. `docs/PROJECT_ARCHITECTURE.md` — cross-layer constraints
5. `docs/LLM_NEW_MODULE_PROMPT.md` — coding standards, envelope, error patterns

---

## 2. Existing Code to Reuse (Do NOT re-implement)

| File | What to reuse |
|---|---|
| `src/services/artifact.service.ts` | `createArtifact()`, `versionArtifact()`, `forkArtifact()` — extend, do not replace |
| `src/services/file.service.ts` | `getReadyFile()`, `updateFileStatus()`, file CRUD — extend only |
| `src/workers/file.worker.ts` | Replace stub body only; keep BullMQ wiring and job registration unchanged |
| `src/tools/fileRead.tool.ts` | Replace `fileService.getReadyFile()` call with `retrieve()` from new retriever; keep tool interface unchanged |
| `src/lib/qdrant.ts` (from Task 2) | `getQdrantClient()`, `ensureCollection()` |
| `src/models/providers/openai.ts` | `openai.embeddings.create()` — reuse existing client for embeddings |
| `src/router/index.ts` | `streamCompletion()` — reuse for subagent LLM calls |
| `src/db/pool.ts` (or equivalent) | Postgres pool |
| `src/utils/errors.ts` | `AppError`, `Errors.*` |
| `src/utils/response.ts` | `ok()`, `fail()` |
| `marked` | Already installed (`npm list marked`) — use for markdown → HTML rendering |
| `sanitize-html` | Already installed — use for HTML artifact sanitisation |

---

## 3. What NOT to Change

- Do not alter the `artifacts` table schema beyond adding the two new columns (migration 035).
- Do not change the existing `artifact.service.ts` public interface — only extend it.
- Do not change `src/tools/fileGen.tool.ts` — file generation is already working.
- Do not change `src/workers/chat.worker.ts` beyond the small subagent cost attribution addition.
- Do not alter existing migration files 023–032.
- The subagent runtime must **not** have access to the parent's conversation history — enforce by passing a clean `messages: []` to every subagent invocation.

---

## 4. New Files to Create

### 4.1 DB Migrations

**`src/db/migrations/033_file_chunks.sql`**
```sql
CREATE TABLE IF NOT EXISTS file_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id      UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index  INT NOT NULL,
  qdrant_id    TEXT NOT NULL,
  page         INT,
  section      TEXT,
  token_count  INT NOT NULL DEFAULT 0,
  UNIQUE (file_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id ON file_chunks(file_id);
```

**`src/db/migrations/034_subagent_runs.sql`**
```sql
CREATE TABLE IF NOT EXISTS subagent_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_job_id   UUID NOT NULL,
  task            TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INT NOT NULL DEFAULT 0,
  output_tokens   INT NOT NULL DEFAULT 0,
  credits_used    NUMERIC(10,2) NOT NULL DEFAULT 0,
  duration_ms     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subagent_runs_parent_job_id ON subagent_runs(parent_job_id);
```

**`src/db/migrations/035_artifacts_preview.sql`**
```sql
ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS preview_html          TEXT,
  ADD COLUMN IF NOT EXISTS preview_generated_at  TIMESTAMPTZ;
```

### 4.2 `src/workers/file.worker.ts` (replace stub body)

Replace the stub `console.log('file_job_processed_stub')` with the full ingestion pipeline. Keep the BullMQ job processor registration and queue connection unchanged.

**Pipeline steps:**

```
1. UPDATE files SET status = 'processing' WHERE id = fileId

2. Fetch file record (mime type, storage path, user_id)

3. Parse based on mime type:
   - 'application/pdf', 'application/vnd.openxmlformats-officedocument.*', '.docx', '.xlsx':
       POST to Unstructured.io:
         URL: process.env.UNSTRUCTURED_URL + '/general/v0/general'
         Body: multipart with file binary, strategy='auto'
         Response: array of {text, type, metadata} elements
         extractedText = elements.map(e => e.text).join('\n\n')
   - 'text/csv':
       extractedText = raw file content (read from storage path)
   - 'text/plain', '.md':
       extractedText = raw file content
   - Default: mark file status='failed', error='unsupported_mime'; return

4. Chunk extracted text:
   chunkSize = 1000 tokens (≈ 4000 chars)
   overlap    = 100 tokens (≈ 400 chars)
   chunks     = splitIntoChunks(extractedText, chunkSize, overlap)

5. Ensure Qdrant collection `files:{userId}` exists (vectorSize=1536, distance=Cosine)

6. For each chunk (in batches of 20 to avoid rate limits):
   a. embedding = await embedText(chunk.text)     // openai text-embedding-3-small
   b. qdrantId  = uuid()
   c. await qdrantClient.upsert(`files:${userId}`, {
        points: [{ id: qdrantId, vector: embedding,
          payload: { fileId, chunkIndex: chunk.index, text: chunk.text,
                     page: chunk.page ?? null, section: chunk.section ?? null } }]
      })
   d. INSERT INTO file_chunks (file_id, chunk_index, qdrant_id, page, section, token_count)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (file_id, chunk_index) DO NOTHING

7. UPDATE files SET status = 'ready', vectorised = true,
                    extracted_text = (extractedText if < 64KB else null)
   WHERE id = fileId

8. Publish SSE event on user notification channel:
   { type: 'file.ready', fileId, conversationId }
```

Helper `splitIntoChunks(text, chunkSize, overlap)`: sliding window on character count (`chunkSize * 4` chars, `overlap * 4` chars overlap).

Error handling: wrap entire pipeline in try/catch. On error: `UPDATE files SET status = 'failed', error_message = err.message`.

### 4.3 `src/files/retriever.ts`

```typescript
export async function retrieve(
  fileId: string,
  userId: string,
  subQuery?: string,
): Promise<string> {
  if (subQuery) {
    // Semantic retrieval
    await ensureCollection(`files:${userId}`, 1536);
    const embedding = await embedText(subQuery);
    const results = await getQdrantClient().search(`files:${userId}`, {
      vector: embedding,
      limit: 10,
      filter: { must: [{ key: 'fileId', match: { value: fileId } }] },
      with_payload: true,
    });
    return results
      .map(r => (r.payload as any).text as string)
      .join('\n\n---\n\n');
  } else {
    // Document order retrieval: top 20 chunks by chunkIndex
    const rows = await db.query(
      `SELECT fc.chunk_index, qc.text
       FROM file_chunks fc
       JOIN LATERAL (
         SELECT payload->>'text' AS text
         FROM /* qdrant_id lookup placeholder */ (VALUES (fc.qdrant_id)) t(qid)
       ) qc ON true
       WHERE fc.file_id = $1
       ORDER BY fc.chunk_index ASC LIMIT 20`,
      [fileId]
    );
    // If Qdrant query is complex, use a simpler approach:
    // Fetch qdrant_ids from file_chunks, batch-fetch payloads from Qdrant, sort by chunk_index
    const chunks = await db.query(
      `SELECT qdrant_id, chunk_index FROM file_chunks WHERE file_id = $1 ORDER BY chunk_index ASC LIMIT 20`,
      [fileId]
    );
    if (chunks.rows.length === 0) {
      // Fall back to extracted_text in files table
      const file = await db.query(`SELECT extracted_text FROM files WHERE id = $1`, [fileId]);
      return file.rows[0]?.extracted_text ?? '';
    }
    const qdrantIds = chunks.rows.map(r => r.qdrant_id);
    const points = await getQdrantClient().retrieve(`files:${userId}`, {
      ids: qdrantIds,
      with_payload: true,
    });
    // Sort by chunk_index order from DB
    const ordered = chunks.rows.map(r =>
      points.find(p => p.id === r.qdrant_id)?.payload?.['text'] as string ?? ''
    );
    return ordered.join('\n\n---\n\n');
  }
}
```

### 4.4 `src/artifacts/artifact.storage.ts`

Storage abstraction. Switch via `STORAGE_DRIVER` env var (`local` or `r2`).

```typescript
export interface ArtifactStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  signedUrl(key: string, ttlSec: number): Promise<string>;
  delete(key: string): Promise<void>;
}

// Local implementation (dev default)
class LocalStorage implements ArtifactStorage {
  private baseDir = process.env.ARTIFACT_STORAGE_PATH ?? './storage/artifacts';

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const fullPath = path.join(this.baseDir, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, body);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(path.join(this.baseDir, key));
  }

  async signedUrl(key: string, _ttlSec: number): Promise<string> {
    // In dev, return a local file URL (served by a static route if needed)
    return `/internal/artifacts/file/${encodeURIComponent(key)}`;
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(path.join(this.baseDir, key)).catch(() => {});
  }
}

// R2 implementation (prod)
class R2Storage implements ArtifactStorage {
  // Use S3-compatible API: AWS SDK v3 with custom endpoint
  // endpoint: process.env.R2_ENDPOINT
  // bucket:   process.env.R2_BUCKET
  // credentials: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
  // Implement using @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner
}

export function getArtifactStorage(): ArtifactStorage {
  return process.env.STORAGE_DRIVER === 'r2' ? new R2Storage() : new LocalStorage();
}
```

### 4.5 `src/artifacts/preview.ts`

```typescript
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export async function generatePreview(artifact: {
  id: string;
  artifactType: string;
  contentText?: string;
  storagePath?: string;
}): Promise<{ previewHtml: string | null; signedUrl?: string }> {

  switch (artifact.artifactType) {
    case 'markdown': {
      const html = await marked.parse(artifact.contentText ?? '');
      const safe = sanitizeHtml(html, { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['pre','code']) });
      return { previewHtml: safe };
    }
    case 'code': {
      const escaped = (artifact.contentText ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return { previewHtml: `<pre><code>${escaped}</code></pre>` };
    }
    case 'html': {
      const safe = sanitizeHtml(artifact.contentText ?? '', {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['style','section','article','header','footer','nav','main']),
        allowedAttributes: { '*': ['class','id','style'] },
      });
      return { previewHtml: safe };
    }
    case 'csv': {
      const rows = parseCsvPreview(artifact.contentText ?? '', 50);
      return { previewHtml: renderCsvTable(rows) };
    }
    case 'image': {
      // Return a signed URL; preview_html stays null
      if (artifact.storagePath) {
        const url = await getArtifactStorage().signedUrl(artifact.storagePath, 3600);
        return { previewHtml: null, signedUrl: url };
      }
      return { previewHtml: null };
    }
    default:
      return { previewHtml: null };
  }
}

function parseCsvPreview(csv: string, maxRows: number): string[][] {
  return csv.split('\n').slice(0, maxRows + 1).map(line => line.split(',').map(c => c.trim()));
}

function renderCsvTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const [header, ...body] = rows;
  const ths = header.map(h => `<th>${sanitizeHtml(h)}</th>`).join('');
  const trs = body.map(row =>
    `<tr>${row.map(cell => `<td>${sanitizeHtml(cell)}</td>`).join('')}</tr>`
  ).join('');
  return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}
```

### 4.6 `src/runtime/subagent.ts`

Isolated context execution. **Critical invariant:** subagent never sees parent conversation.

```typescript
export interface SubagentInput {
  task: 'summarise_pages' | 'extract_facts' | 'compare_documents';
  inputs: unknown;
  parentJobId: string;
  modelTier?: 'nano' | 'standard' | 'high';
  maxOutputTokens?: number;
}

export interface SubagentResult {
  summary: string;
  tokensUsed: number;
  creditsUsed: number;
  durationMs: number;
  sources?: string[];
}

// System prompts per task type (stable, cacheable)
const TASK_PROMPTS: Record<SubagentInput['task'], string> = {
  summarise_pages:
    'You are a concise summariser. Given web page content, produce a 3-bullet summary. Be factual and brief.',
  extract_facts:
    'You are a fact extractor. Given a document excerpt, list the key facts as bullet points.',
  compare_documents:
    'You are a document analyst. Given two document excerpts, compare them on key dimensions.',
};

export async function spawnSubagent(input: SubagentInput): Promise<SubagentResult> {
  const start = Date.now();

  // Resolve model: use systemModelConfig for tier resolution or fall back to a known nano model
  const model = await resolveSubagentModel(input.modelTier ?? 'standard');

  const systemPrompt = TASK_PROMPTS[input.task];
  const userMessage = typeof input.inputs === 'string'
    ? input.inputs
    : JSON.stringify(input.inputs);

  // Fresh isolated messages — no parent context
  const messages = [{ role: 'user' as const, content: userMessage }];

  // Call the provider directly (use streamCompletion or a simplified single-turn call)
  // maxOutputTokens hard cap: default 800
  const maxTokens = Math.min(input.maxOutputTokens ?? 800, 800);

  let outputText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    // Use a simplified non-streaming call for subagents
    const result = await callProviderSingleTurn({
      model,
      systemPrompt,
      messages,
      maxOutputTokens: maxTokens,
    });
    outputText = result.content;
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
  } catch (err) {
    throw new Error(`[subagent] ${input.task} failed: ${(err as Error).message}`);
  }

  const durationMs = Date.now() - start;
  const creditsUsed = computeCreditsForTokens(model, inputTokens, outputTokens);

  // Record subagent run
  await db.query(
    `INSERT INTO subagent_runs (parent_job_id, task, model, input_tokens, output_tokens, credits_used, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.parentJobId, input.task, model, inputTokens, outputTokens, creditsUsed, durationMs]
  ).catch(err => console.error('[subagent] failed to record run:', err));

  // Update parent api_calls.metadata.subagentCost (best-effort)
  await db.query(
    `UPDATE api_calls SET metadata = jsonb_set(
       COALESCE(metadata, '{}'),
       '{subagentCost}',
       (COALESCE((metadata->>'subagentCost')::numeric, 0) + $2)::text::jsonb
     ) WHERE request_id = $1`,
    [input.parentJobId, creditsUsed]
  ).catch(() => {});

  return { summary: outputText, tokensUsed: inputTokens + outputTokens, creditsUsed, durationMs };
}

async function resolveSubagentModel(tier: string): Promise<string> {
  // Query system_model_config for the matching tier
  const row = await db.query(
    `SELECT model_id FROM system_model_config WHERE tier = $1 AND is_active = true LIMIT 1`,
    [tier]
  ).catch(() => ({ rows: [] as any[] }));
  if (row.rows[0]?.model_id) return row.rows[0].model_id;
  // Fallback
  return 'claude-haiku-4-5-20251001';
}
```

---

## 5. Files to Modify

### 5.1 `src/tools/fileRead.tool.ts`

Replace the current `fileService.getReadyFile(fileId)` call with the new retriever:

```typescript
import { retrieve } from '../files/retriever';

// In execute():
const content = await retrieve(params.fileId, ctx.userId, params.sub_query);
```

Keep all other tool interface unchanged (name, description, jsonSchema, planRequired).

### 5.2 `src/services/artifact.service.ts`

**Change 1 — Use storage abstraction:**
Replace all `inline://*` placeholder path assignments with calls to `getArtifactStorage().put()`.

When artifact content > 64KB:
```typescript
const key = `artifacts/${userId}/${artifactId}`;
await getArtifactStorage().put(key, Buffer.from(contentText, 'utf-8'), 'text/plain');
// Store key in artifacts.storage_path; set content_text = null
```

When artifact content ≤ 64KB: keep storing inline in `content_text` column.

**Change 2 — Call preview generation:**
After creating or updating an artifact, call `generatePreview()` and update the row:
```typescript
const { previewHtml } = await generatePreview(artifact);
if (previewHtml !== null) {
  await db.query(
    `UPDATE artifacts SET preview_html = $1, preview_generated_at = now() WHERE id = $2`,
    [previewHtml, artifact.id]
  );
}
```

**Change 3 — Expose previewHtml in GET response:**
In the artifact controller's GET handler, include `preview_html` and `preview_generated_at` in the response data. No route changes needed.

### 5.3 `src/agents/research.agent.ts` (if it exists as a class/object with postProcess hook)

Wire subagent usage for multi-page web fetches. In the agent's `postProcess()` or in the research-specific tool result handling:

For each URL fetched by `web_fetch` tool (when >1 URL in the same turn), spawn a subagent:
```typescript
import { spawnSubagent } from '../runtime/subagent';

const summaries = await Promise.all(
  fetchedPages.map(page =>
    spawnSubagent({
      task: 'summarise_pages',
      inputs: page.content.slice(0, 8000), // cap input
      parentJobId: ctx.jobId,
      modelTier: 'nano',
      maxOutputTokens: 300,
    }).catch(() => ({ summary: '[summarisation failed]', tokensUsed: 0, creditsUsed: 0, durationMs: 0 }))
  )
);
// Inject summaries as tool result context back to the parent agent
```

If `research.agent.ts` is purely a descriptor object (no postProcess), add a `postProcess` method that performs this summarisation step after the agent loop completes.

---

## 6. DB Migrations

Run order:
1. `033_file_chunks.sql`
2. `034_subagent_runs.sql`
3. `035_artifacts_preview.sql`

All must be idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).

---

## 7. API Surface

No new user-facing routes. Changes are in internal services only.

Existing endpoints that change response shape:

| Method | Path | Change |
|---|---|---|
| `GET` | `/api/v1/artifacts/:id` | Add `previewHtml` (string \| null) and `previewGeneratedAt` (ISO timestamp \| null) to data object |

No new route mounts. No Postman group additions needed (artifact endpoint already covered). Add a test case to the existing Module 8 / artifacts Postman folder verifying `previewHtml` is populated for a markdown artifact.

---

## 8. Error Codes

| Code | Condition |
|---|---|
| `UNPROCESSABLE_ENTITY` | File mime type not supported for ingestion |
| `NOT_FOUND` | fileId not found or not ready when fileRead tool is called |

Unstructured.io errors: mark file `status='failed'`, `error_message='ingestion_failed'`. Do not throw — the worker should log and ack the job (prevent infinite retries).

Subagent errors: never surface to end user. Log and return fallback summary string.

---

## 9. Postman Updates

No new folders. Add the following to the existing **"Module 8 - Artifact Contracts"** folder:

- A test note on `GET /api/v1/artifacts/:id`: verify `data.previewHtml` is a non-empty string for an artifact of type `markdown`.

Add a manual test scenario description (comment in Postman) for the file ingestion flow:
1. Upload file → `status: pending`
2. Poll `GET /api/v1/files/:id` until `status: ready`
3. Start a `document` agent chat referencing the fileId
4. Confirm the agent's response uses content from the file

---

## 10. Verification Steps

1. **File ingestion — happy path**: Upload a PDF. Call `GET /api/v1/files/:id` polling until `status: ready`. Query `SELECT count(*) FROM file_chunks WHERE file_id = ?` — expect > 0. Check Qdrant collection `files:{userId}` has points.

2. **File read tool — semantic query**: In a `document`-agent conversation with the fileId attached, ask a question that matches specific content in the file. Confirm the tool result includes relevant chunk text (not just the full extracted text).

3. **File read tool — no sub-query**: Use `file_read` without a sub-query. Confirm tool returns up to 20 chunks in document order.

4. **Artifact preview — markdown**: Use `writer` agent to generate a markdown artifact. Call `GET /api/v1/artifacts/:id`. Confirm `previewHtml` is non-null, contains `<p>` or `<h1>` tags (rendered HTML).

5. **Artifact preview — CSV**: Generate a CSV artifact via `analyst` agent. Confirm `previewHtml` contains an HTML `<table>` with correct row count (max 50).

6. **Artifact storage — large content**: Generate an artifact > 64KB. Confirm `content_text` is null in DB, `storage_path` is set, and `GET /api/v1/artifacts/:id` still returns the content (retrieved from storage).

7. **Subagent runtime**: Use `research` agent on a multi-URL query. After completion, query `SELECT * FROM subagent_runs WHERE parent_job_id = ?` — expect one row per fetched page. Confirm `api_calls.metadata.subagentCost` is non-zero.

8. **Subagent isolation**: Confirm subagent rows in `subagent_runs` have no reference to parent conversation messages. Subagent must not leak user PII from the parent context.

9. **File ingestion — unsupported mime**: Upload an MP4. Confirm file row gets `status='failed'`, `error_message` is set, no crash.
