# Layer 3 Task 2 — Memory Architecture & Semantic Cache
## Implementation Specification

> **Status:** Ready for Implementation
> **Depends on:** Task 1 (`LAYER3_TASK1_STREAMING_PROMPT_TELEMETRY.md`) — `api_calls` table and `src/prompt/assembler.ts` must exist
> **Modules:** M17 (Semantic Response Cache), M18 (Memory Architecture)
> **Last Updated:** 2026-05-08

---

## 1. Source Priority

1. `docs/LAYER3_AGENT_EXECUTION.md` §8 (Module 17 — Semantic Cache) and §9 (Module 18 — Memory Architecture)
2. `docs/LAYER3_RUNTIME_PROVIDER_PROMPT_REFERENCE.md` §6 (prompt assembly rules for memory injection)
3. `docs/PROJECT_ARCHITECTURE.md` — cross-layer constraints
4. `docs/LLM_NEW_MODULE_PROMPT.md` — coding standards, envelope, error patterns

---

## 2. Existing Code to Reuse (Do NOT re-implement)

| File | What to reuse |
|---|---|
| `src/lib/redis.ts` (or equivalent) | Existing Redis client singleton |
| `src/workers/chat.worker.ts` | Job lifecycle hooks — add semantic cache check before router call; add memory write/recall calls after job completion |
| `src/prompt/assembler.ts` (from Task 1) | `assemblePrompt()` — modify to accept `retrievedContext` already set; add `KNOWN ABOUT USER:` injection point in fresh suffix |
| `src/db/pool.ts` (or equivalent) | Postgres pool |
| `src/utils/errors.ts` | `AppError`, `Errors.*` |
| `src/utils/response.ts` | `ok()`, `fail()` |
| `src/gateway/auth.middleware.ts` | Bearer token auth for new memory routes |
| OpenAI SDK (already installed) | `openai.embeddings.create()` for `text-embedding-3-small` |

---

## 3. What NOT to Change

- Do not alter existing `chat.worker.ts` job lifecycle logic (SSE, wallet, usage_records).
- Do not modify `src/router/` files.
- Do not change existing DB migrations.
- Do not modify `src/services/summariser.service.ts`.
- The semantic cache must be **additive** — if Qdrant is unreachable, log the error and continue without cache (do not fail the job).
- Memory writes are fire-and-forget — if they fail, log and continue.

---

## 4. New Files to Create

### 4.1 DB Migrations

**`src/db/migrations/031_memory_facts.sql`**
```sql
CREATE TABLE IF NOT EXISTS memory_facts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fact              TEXT NOT NULL,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  confidence        NUMERIC(3,2) NOT NULL DEFAULT 0.80,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by     UUID REFERENCES memory_facts(id),
  UNIQUE (user_id, fact)
);

CREATE INDEX IF NOT EXISTS idx_memory_facts_user_id    ON memory_facts(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_facts_created_at ON memory_facts(created_at);
```

**`src/db/migrations/032_semantic_cache_hits.sql`**
```sql
CREATE TABLE IF NOT EXISTS semantic_cache_hits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cache_id      TEXT NOT NULL,
  similarity    NUMERIC(4,3) NOT NULL,
  saved_credits NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_hits_user_id    ON semantic_cache_hits(user_id);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_hits_created_at ON semantic_cache_hits(created_at);
```

Also add an opt-out column to users:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS semantic_cache_optout BOOLEAN NOT NULL DEFAULT false;
```

### 4.2 `src/lib/qdrant.ts`

Singleton Qdrant client. Install package first: `npm install @qdrant/js-client-rest`.

```typescript
import { QdrantClient } from '@qdrant/js-client-rest';

let client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!client) {
    const url = process.env.QDRANT_URL;
    if (!url) throw new Error('QDRANT_URL env var not set');
    client = new QdrantClient({
      url,
      apiKey: process.env.QDRANT_API_KEY,
    });
  }
  return client;
}

export async function ensureCollection(
  name: string,
  vectorSize: number,
  distance: 'Cosine' | 'Dot' = 'Cosine',
): Promise<void> {
  const client = getQdrantClient();
  const existing = await client.collectionExists(name);
  if (!existing.exists) {
    await client.createCollection(name, {
      vectors: { size: vectorSize, distance },
    });
  }
}
```

`text-embedding-3-small` produces 1536-dimensional vectors — use `vectorSize = 1536` everywhere.

### 4.3 `src/memory/session.memory.ts`

Redis-backed conversation hydration.

```typescript
const SESSION_TTL_SECONDS = 86400; // 24h
const KEY = (conversationId: string) => `session:${conversationId}`;

export async function hydrateSession(conversationId: string): Promise<Message[]> {
  // 1. Try Redis
  const cached = await redis.get(KEY(conversationId));
  if (cached) return JSON.parse(cached) as Message[];
  // 2. Cold: load from DB (last 50 messages ordered by created_at asc)
  const rows = await db.query(
    `SELECT role, content FROM messages
     WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 50`,
    [conversationId]
  );
  const messages = rows.rows as Message[];
  await redis.setEx(KEY(conversationId), SESSION_TTL_SECONDS, JSON.stringify(messages));
  return messages;
}

export async function persistSession(conversationId: string, messages: Message[]): Promise<void> {
  await redis.setEx(KEY(conversationId), SESSION_TTL_SECONDS, JSON.stringify(messages));
}
```

Called in `chat.worker.ts`: call `hydrateSession` before prompt assembly; call `persistSession` after the assistant message is saved.

### 4.4 `src/memory/vector.memory.ts`

Long-term per-user Qdrant memory.

**Fact extraction (write path):**
```typescript
export async function extractAndStoreFacts(
  userId: string,
  assistantMessage: string,
  userMessage: string,
  sourceMessageId: string,
): Promise<void> {
  // 1. Call cheap model (use systemModelConfig nano tier or hardcoded haiku/gpt-4o-mini)
  //    to extract ≤3 durable facts about the user.
  //    Prompt: "From this exchange, list at most 3 durable facts about the user
  //             (preferences, projects, identity, recurring topics).
  //             One fact per line. If none, output 'none'."
  // 2. Parse lines; skip 'none'
  // 3. For each fact:
  //    a. Embed via text-embedding-3-small
  //    b. Upsert into Qdrant collection `mem:{userId}`
  //       payload: { fact, sourceMessageId, createdAt: new Date().toISOString(), confidence: 0.8 }
  //       id: sha256(userId + fact) as UUID-compatible hex
  //    c. INSERT INTO memory_facts (user_id, fact, source_message_id, confidence)
  //       ON CONFLICT (user_id, fact) DO NOTHING
}
```

**Recall (read path):**
```typescript
export async function recallFacts(userId: string, query: string): Promise<string[]> {
  // 1. Ensure collection `mem:{userId}` exists
  // 2. Embed query with text-embedding-3-small
  // 3. Search Qdrant `mem:{userId}` top-5 by cosine similarity
  // 4. Return fact strings from payload
  // Returns [] on any error (fail open)
}
```

Collection name: `mem:${userId}` (one per user, hard isolation).

### 4.5 `src/cache/semantic.cache.ts`

Semantic response cache backed by Qdrant.

```typescript
const CACHE_COLLECTION = 'semantic_cache';
const SIMILARITY_THRESHOLD = 0.92;
const FACTUAL_SCORE_THRESHOLD = 0.7;

// Eligible agents
const ELIGIBLE_AGENTS = new Set(['chat', 'writer', 'research']);

// TTLs in seconds
const TTL_MAP: Record<string, number> = {
  generic:         7 * 24 * 3600,
  search_grounded: 4 * 3600,
  code:            24 * 3600,
};

export async function lookupSemanticCache(
  agentSlug: string,
  query: string,
  hasFileAttachments: boolean,
  userOptedOut: boolean,
): Promise<{ answer: string; cacheId: string } | null> {
  if (!ELIGIBLE_AGENTS.has(agentSlug)) return null;
  if (hasFileAttachments) return null;
  if (userOptedOut) return null;
  if (hasPiiTokens(query)) return null;

  try {
    await ensureCollection(CACHE_COLLECTION, 1536);
    const queryEmbedding = await embedText(query);
    const results = await getQdrantClient().search(CACHE_COLLECTION, {
      vector: queryEmbedding,
      limit: 5,
      with_payload: true,
      filter: {
        must: [{ key: 'agent_slug', match: { value: agentSlug } }],
      },
    });

    for (const result of results) {
      const payload = result.payload as CachePayload;
      const age = Date.now() - new Date(payload.createdAt).getTime();
      const ttl = (TTL_MAP[payload.contentType] ?? TTL_MAP.generic) * 1000;
      if (result.score >= SIMILARITY_THRESHOLD &&
          payload.factualScore >= FACTUAL_SCORE_THRESHOLD &&
          age < ttl) {
        return { answer: payload.answer, cacheId: result.id as string };
      }
    }
  } catch (err) {
    console.error('[semantic-cache] lookup error:', err);
  }
  return null;
}

export async function writeSemanticCache(
  agentSlug: string,
  query: string,
  answer: string,
  contentType: 'generic' | 'search_grounded' | 'code',
): Promise<void> {
  if (!ELIGIBLE_AGENTS.has(agentSlug)) return;
  if (hasPiiTokens(query)) return;

  try {
    await ensureCollection(CACHE_COLLECTION, 1536);
    const id = sha256hex(agentSlug + normalizeQuery(query));
    const embedding = await embedText(query);
    const factualScore = estimateFactualScore(answer); // heuristic: 1.0 for factual, lower for opinionated

    await getQdrantClient().upsert(CACHE_COLLECTION, {
      points: [{
        id,
        vector: embedding,
        payload: {
          answer,
          agent_slug: agentSlug,
          contentType,
          factualScore,
          createdAt: new Date().toISOString(),
        },
      }],
    });
  } catch (err) {
    console.error('[semantic-cache] write error:', err);
  }
}

// PII check: simple regex sweep for common PII patterns
function hasPiiTokens(text: string): boolean {
  return /\b\d{3}-\d{2}-\d{4}\b/.test(text) ||   // SSN
         /\b[A-Z]{1,2}\d{6,9}\b/.test(text) ||    // passport
         /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/.test(text); // credit card
}
```

### 4.6 `src/routes/user/memory.routes.ts`

```typescript
import { Router } from 'express';
import * as memoryController from '../../controllers/user/memory.controller';

const router = Router();

router.get('/',      memoryController.listFacts);
router.delete('/:id', memoryController.deleteFact);
router.delete('/',   memoryController.purgeAllFacts);

export default router;
```

Register in `src/routes/user/index.ts`:
```typescript
import memoryRoutes from './memory.routes';
userRouter.use('/memory', memoryRoutes);
```

### 4.7 `src/controllers/user/memory.controller.ts`

**`listFacts`** — `GET /api/v1/memory`
- Query params: `page` (default 1), `limit` (default 20, max 100)
- SQL: `SELECT id, fact, confidence, created_at FROM memory_facts WHERE user_id = $1 AND superseded_by IS NULL ORDER BY created_at DESC LIMIT $2 OFFSET $3`
- Return: `ok(res, { facts: rows, total, page, limit })`

**`deleteFact`** — `DELETE /api/v1/memory/:id`
- Validate `req.params.id` is UUID
- SQL: `DELETE FROM memory_facts WHERE id = $1 AND user_id = $2 RETURNING *`
- If 0 rows: `fail(res, Errors.NOT_FOUND('memory_fact'))`
- Also delete from Qdrant: `getQdrantClient().delete('mem:' + userId, { points: [qdrantIdForFact] })`
  - Map Qdrant ID: recompute `sha256hex(userId + fact)` from the returned DB row
- Return: `ok(res, { deleted: true })`

**`purgeAllFacts`** — `DELETE /api/v1/memory`
- SQL: `DELETE FROM memory_facts WHERE user_id = $1`
- Also: `getQdrantClient().deleteCollection('mem:' + userId)` (will be recreated on next write)
- Return: `ok(res, { purged: true })`

All three require the user to be authenticated (`req.user` set by `authMiddleware`). Users can only touch their own facts — enforce `WHERE user_id = req.user.id`.

---

## 5. Files to Modify

### 5.1 `src/workers/chat.worker.ts`

Add the following hooks (all additive — do not remove existing logic):

**Before router call (semantic cache check):**
```typescript
const cacheHit = await lookupSemanticCache(
  agentSlug, userQuery, hasFileAttachments, user.semantic_cache_optout
);
if (cacheHit) {
  // Stream the cached answer via SSE as if it were a normal response
  await publishSSE(jobId, { type: 'chunk', delta: cacheHit.answer });
  await publishSSE(jobId, { type: 'finish', reason: 'cache_hit' });
  // Write usage row with cache_hit_layer = 'semantic', credits = 0.05 × normal estimate
  await writeUsageRecord({ ..., cacheHitLayer: 'semantic', creditsCharged: estimateCredits(agentSlug) * 0.05 });
  // Write semantic_cache_hits row
  await db.query(
    `INSERT INTO semantic_cache_hits (user_id, cache_id, similarity, saved_credits) VALUES ($1,$2,$3,$4)`,
    [userId, cacheHit.cacheId, 0.95, estimateCredits(agentSlug) * 0.95]
  );
  return; // skip full router call
}
```

**After assistant message saved (memory write, fire-and-forget):**
```typescript
extractAndStoreFacts(userId, assistantContent, userQuery, assistantMessageId)
  .catch(err => console.error('[memory] fact extraction failed:', err));
```

**After full job completion (semantic cache write):**
```typescript
writeSemanticCache(agentSlug, userQuery, assistantContent, inferContentType(agentSlug))
  .catch(err => console.error('[semantic-cache] write failed:', err));
```

**Session hydration:** Call `hydrateSession(conversationId)` before prompt assembly to get warm message history. Call `persistSession(conversationId, updatedMessages)` after assistant message is saved.

### 5.2 `src/prompt/assembler.ts` (from Task 1)

Add memory recall injection into the fresh suffix:

In `assemblePrompt()`, if `retrievedContext` is provided by the caller (memory recall results), append to the last user message:
```
KNOWN ABOUT USER:
- fact 1
- fact 2
```

The `retrievedContext` is built by the caller (`chat.worker.ts`) before calling `assemblePrompt`:
```typescript
const recalledFacts = await recallFacts(userId, userQuery);
const retrievedContext = recalledFacts.length > 0
  ? recalledFacts.join('\n')
  : undefined;
```

This content goes into the **fresh suffix** (not cached prefix) of the assembled prompt.

---

## 6. DB Migrations

Run order:
1. `031_memory_facts.sql`
2. `032_semantic_cache_hits.sql` (independent; can run in same transaction)
3. The `ALTER TABLE users ADD COLUMN semantic_cache_optout` (in `032_semantic_cache_hits.sql` or its own file)

All migrations must be idempotent.

---

## 7. API Surface

New route mount added to user router:

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/memory` | Bearer token | List user's memory facts (paginated) |
| `DELETE` | `/api/v1/memory/:id` | Bearer token | Delete a specific memory fact |
| `DELETE` | `/api/v1/memory` | Bearer token | Purge all memory facts for user |

Request/response shapes use the standard envelope from `docs/Project Foundation/03_REQUEST_RESPONSE.md`.

**`GET /api/v1/memory` response:**
```json
{
  "success": true,
  "data": {
    "facts": [
      { "id": "uuid", "fact": "User prefers TypeScript", "confidence": 0.80, "created_at": "..." }
    ],
    "total": 12,
    "page": 1,
    "limit": 20
  }
}
```

**`DELETE /api/v1/memory/:id` response:**
```json
{ "success": true, "data": { "deleted": true } }
```

**`DELETE /api/v1/memory` response:**
```json
{ "success": true, "data": { "purged": true } }
```

---

## 8. Error Codes

| Code | Condition |
|---|---|
| `NOT_FOUND` | memory fact not found or does not belong to user |
| `VALIDATION_FAILED` | invalid UUID in `:id` param |

Use existing `Errors.*` patterns from `src/utils/errors.ts`.

Qdrant errors are logged and swallowed — they must never surface as HTTP errors to the user.

---

## 9. Postman Updates

Add a new folder **"Module 18 - User Memory Contracts"** with 3 requests:

1. `GET {{baseUrl}}/api/v1/memory`
   - Headers: `x-platform: web`, `Authorization: Bearer {{accessToken}}`
   - Query params: `page=1&limit=20`
   - Test: status 200, `data.facts` is array

2. `DELETE {{baseUrl}}/api/v1/memory/:id`
   - Headers: same
   - Path variable: `id` — set to a fact ID from previous GET
   - Test: status 200, `data.deleted === true`

3. `DELETE {{baseUrl}}/api/v1/memory`
   - Headers: same
   - Test: status 200, `data.purged === true`

---

## 10. Verification Steps

1. **Session memory warm path**: Send a chat message. Check Redis for key `session:{conversationId}` — confirm it exists and contains the message array. Send a follow-up message and confirm the context is preserved without a DB read (add a log line in `hydrateSession` for the cache hit path).

2. **Fact extraction**: Complete a conversation that reveals user preferences (e.g. "I always use Python"). Query `SELECT * FROM memory_facts WHERE user_id = ?` — confirm a fact row appears. Also confirm the Qdrant collection `mem:{userId}` has a point.

3. **Memory recall**: Start a new conversation. Send a query related to the stored fact. Confirm `KNOWN ABOUT USER:` section appears in the assembled prompt (add a debug log in `assemblePrompt` or check server logs).

4. **Semantic cache — miss then hit**: Send the same `chat`-agent query twice. First call: `cache_layer = 'none'`. Second call: confirm `cache_layer = 'semantic'` in `usage_records` and a row in `semantic_cache_hits`. Confirm second call is faster (no LLM call).

5. **Semantic cache — ineligible**: Send a `document`-agent query (not in eligible set). Confirm no cache check or write happens.

6. **Memory endpoints**: Call `GET /api/v1/memory` — returns facts from step 2. Call `DELETE /api/v1/memory/{id}` — row gone from DB + Qdrant. Call `DELETE /api/v1/memory` — all facts gone, Qdrant collection deleted.

7. **Qdrant down resilience**: Stop Qdrant container. Send a chat message. Confirm the job completes normally (no 500); cache/memory errors are logged only.
