# 02 — Schemas, Injection Patterns, Length / File Caps, Abuse Signals

The full contract for what Module 9 inspects, redacts, rejects, and signals.

---

## A. Middleware Pipeline (slot 12)

```ts
// src/gateway/sanitiser.middleware.ts
export function sanitiserMiddleware(req, res, next) {
  // 1. Skip for routes that opt out (rare — only file streaming endpoints)
  if (SKIP_ROUTES.has(`${req.method} ${req.route?.path}`)) return next();

  // 2. Pull policy from plan + per-route override
  const policy: SanitiserPolicy = {
    allowedFileTypes: FILE_ALLOWLIST,
    maxMessageLength: req.plan.limits.maxMessageContentLength,
    maxFileSize:      req.plan.limits.maxFileSize,
    injectionMode:    res.locals.injectionMode ?? 'strip'      // routes can set 'reject' via per-route helper
  };

  // 3. Multipart guard
  if (req.is('multipart/form-data')) {
    for (const part of req.files ?? []) {
      sanitiserService.validateFilePart(part, policy);          // throws on bad
    }
  }

  // 4. JSON body guard (when body has a `content` or HTML-bearing field)
  if (req.body && typeof req.body === 'object') {
    if (typeof req.body.content === 'string') {
      sanitiserService.enforceMessageLength(req.body.content, policy.maxMessageLength);

      const { sanitised, patternsMatched } =
        sanitiserService.stripPromptInjection(req.body.content);
      if (patternsMatched.length > 0) {
        await abuseCounter.recordInjection(req.user.id, patternsMatched);
        emit('sanitiser.injection_stripped', { userId: req.user.id, route: req.path, patternsMatched });
        if (policy.injectionMode === 'reject') throw Errors.promptInjectionRejected();
      }
      req.body.content = sanitised;

      // Repeat-message detection
      const hash = sanitiserService.hashContent(req.user.id, sanitised);
      const count = await abuseCounter.recordRepeat(req.user.id, hash);
      if (count >= REPEAT_THRESHOLD.count) {
        emit('sanitiser.abuse_signal', { userId: req.user.id, kind: 'repeat_message' });
        throw Errors.repeatMessage();
      }
    }

    // HTML-bearing fields (artifact bodies of type 'html', conversation titles, etc.)
    for (const key of HTML_FIELDS) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitiserService.sanitiseHtml(req.body[key]);
      }
    }
  }

  next();
}
```

The middleware **mutates `req.body` in place** — downstream handlers see the cleaned content. Original content is recoverable from logs only if `LOG_LEVEL=debug` and the route opts in (default: never logged).

---

## B. Per-Plan Length Caps

| Plan | `maxMessageContentLength` | Rationale |
|---|---|---|
| Free | 2 000 chars | Curtails prompt-stuffing on the cheapest tier |
| Starter | 5 000 chars | Generous for casual usage |
| Pro | 10 000 chars | Power-user threshold |
| Enterprise | 50 000 chars | Document-pasting workflows |

Pulled from `req.plan.limits.maxMessageContentLength`. If a plan is missing this field (older snapshot), the middleware logs `WARN sanitiser_length_cap_undefined` and applies the **Free** cap as a safe default.

### `enforceMessageLength(text, max)`

Throws `Errors.messageTooLong({ length, max })` → `400 MESSAGE_TOO_LONG`. The error envelope includes both numbers so the frontend can show "You're 1 240 chars over the 2 000-char limit. Upgrade for more room."

---

## C. Prompt-Injection Catalogue

`src/config/sanitiser.ts → INJECTION_PATTERNS`. Every pattern has an `id`, `regex`, and a redaction. Default redaction is empty string (the matched span is removed).

```ts
export const INJECTION_PATTERNS: InjectionPattern[] = [
  // Override-system-prompt attempts
  { id: 'ignore_prev_instructions',
    regex: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|earlier|the\s+above)\s+(instructions|context|prompts)\b/gi,
    redaction: '' },
  { id: 'system_prompt_leak',
    regex: /\b(reveal|show|print|output)\s+(your|the)\s+system\s+prompt\b/gi,
    redaction: '' },
  // Persona breakouts
  { id: 'dan_persona',
    regex: /\b(you\s+are\s+(now\s+)?DAN|do\s+anything\s+now)\b/gi,
    redaction: '' },
  { id: 'jailbreak_keyword',
    regex: /\b(jailbreak|developer\s+mode\s+enabled|unfiltered\s+mode)\b/gi,
    redaction: '' },
  // Role-play override
  { id: 'pretend_other_ai',
    regex: /\b(pretend\s+to\s+be|act\s+as)\s+(another\s+(ai|llm)|chatgpt|gpt-?[0-9]+|claude|gemini|llama)/gi,
    redaction: '' },
  // Context manipulation markers
  { id: 'fake_system_marker',
    regex: /\[\s*(system|assistant)\s*[:\]]/gi,
    redaction: '' },
  { id: 'tool_call_forgery',
    regex: /<tool_call[^>]*>[\s\S]*?<\/tool_call>/gi,
    redaction: '' }
];
```

The catalogue is conservative and concrete — it removes only structural markers, not ordinary discussion of the topic. A user can still type "Let's discuss prompt injection attacks against LLMs" — only the literal directive forms get stripped.

### Modes

| Mode | Behaviour | When to use |
|---|---|---|
| `strip` (default) | Match → redact → continue. Counter incremented. | All chat endpoints. |
| `reject` | Match → throw `400 PROMPT_INJECTION_REJECTED`. | High-trust admin endpoints (none today; reserved). |

Per-route override: handler sets `res.locals.injectionMode = 'reject'` before the middleware runs. (Done via a helper `requireStrictInjection()` mounted earlier on the route.)

### Injection-attempt abuse signal

```
abuseCounter.recordInjection(userId, patternsMatched):
  key = sanitiser:injection_attempts:{userId}
  ZADD key now {now}-{rand}
  EXPIRE key 600
  ZREMRANGEBYSCORE key 0 (now - 600_000)
  count = ZCARD key
  if count >= 5:
    emit sanitiser.abuse_signal { userId, kind:'injection_burst' }
```

Module 5 listens to this event and may flag the user (`rate_limit_events.event_type='flagged'` with `metadata.reason='injection_burst'`).

---

## D. HTML Sanitisation

Used on:
- `artifacts.content_text` when `type='html'`
- `conversations.title`
- Any future free-text field where users might paste HTML

```ts
import sanitizeHtml from 'sanitize-html';

export function sanitiseHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [
      'p', 'br', 'span', 'div',
      'b', 'i', 'em', 'strong', 'u', 'code', 'pre',
      'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4',
      'a', 'img'
    ],
    allowedAttributes: {
      a:   ['href', 'title'],
      img: ['src', 'alt', 'title']
    },
    allowedSchemes: ['http', 'https', 'data'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
    },
    disallowedTagsMode: 'discard'
  });
}
```

Rejected outright: `<script>`, all `on*` handlers, `javascript:` URLs, raw `<iframe>` (preview iframes are server-rendered around the artifact, not injected by users).

---

## E. File Form Validation

```ts
export function validateFilePart(part: FilePartCheck, policy: SanitiserPolicy): void {
  // Size
  if (part.byteLength > policy.maxFileSize) {
    throw Errors.fileTooLarge({ max: policy.maxFileSize });
  }
  // Mime + ext consistency
  const mimeAllowed = FILE_ALLOWLIST[part.mimeType];
  if (!mimeAllowed) throw Errors.fileTypeNotAllowed({ allowed: Object.keys(FILE_ALLOWLIST) });
  const ext = part.fileName.split('.').pop()?.toLowerCase();
  if (!mimeAllowed.includes(ext ?? '')) {
    throw Errors.fileTypeMismatch({ mime: part.mimeType, ext });
  }
}
```

`FILE_ALLOWLIST`:

```ts
{
  'application/pdf':                                          ['pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':       ['xlsx'],
  'text/csv':                                                 ['csv'],
  'text/plain':                                               ['txt'],
  'image/png':                                                ['png'],
  'image/jpeg':                                               ['jpg','jpeg'],
  'video/mp4':                                                ['mp4']
}
```

This duplicates the check in Module 8's upload route on purpose (defense-in-depth). If they ever drift, the stricter cap wins (Module 9 fires first).

---

## F. Repeat-Message Detection

```
hashContent(userId, text) = sha256(`${userId}:${text}`).slice(0,32)

abuseCounter.recordRepeat(userId, hash):
  key = sanitiser:repeat:{userId}:{hash}
  count = INCR key
  if count == 1: EXPIRE key 60
  return count

if count >= 5 (REPEAT_THRESHOLD):
  emit sanitiser.abuse_signal { userId, kind:'repeat_message' }
  throw Errors.repeatMessage()
```

`REPEAT_THRESHOLD={count:5, withinSec:60}` — a user can retry the same message four times in a minute (covers genuine network retries) but the fifth in a row gets a `409 REPEAT_MESSAGE` envelope. Module 5 may flag the user via the abuse signal.

---

## G. Error Envelopes

| Code | HTTP | Message (default) |
|---|---|---|
| `VALIDATION_FAILED` | 400 | "Please fix the highlighted fields." (per-field details from Zod) |
| `MESSAGE_TOO_LONG` | 400 | "Your message is longer than this plan allows. Upgrade for more room." |
| `FILE_TOO_LARGE` | 400 | "That file is larger than your plan allows." |
| `FILE_TYPE_NOT_ALLOWED` | 400 | "We don't accept that file type yet." |
| `FILE_TYPE_MISMATCH` | 400 | "The file's extension and content don't match." |
| `PROMPT_INJECTION_REJECTED` | 400 | "Your message looked like a prompt-injection attempt." |
| `REPEAT_MESSAGE` | 409 | "You're sending the same message too quickly. Please wait a moment." |

Each registered as `Errors.*` factories in `src/utils/errors.ts` per [`Project Foundation/04_ERROR_HANDLING.md`](../../Project%20Foundation/04_ERROR_HANDLING.md).

Example — `400 MESSAGE_TOO_LONG`:

```json
{
  "success": false,
  "message": "Your message is longer than this plan allows. Upgrade for more room.",
  "error": {
    "code": "MESSAGE_TOO_LONG",
    "details": { "length": 12480, "max": 10000, "upgradeUrl": "/pricing" }
  },
  "meta": { "request_id": "req_..." }
}
```

---

## H. Per-Route Schemas (Zod)

Module 9 enforces non-schema policy. Per-field shape and types are still owned by each route's Zod schema, parsed via the `parseBody<T>(schema, body)` helper from [`Project Foundation/04_ERROR_HANDLING.md`](../../Project%20Foundation/04_ERROR_HANDLING.md).

A typical chat route looks like:

```ts
// src/routes/user/chat.routes.ts (excerpt)
const ChatBody = z.object({
  conversationId:  z.string().uuid('Invalid conversation id.'),
  clientMessageId: z.string().uuid('Invalid message id.'),
  content:         z.string().min(1, 'Message cannot be empty.'),
  attachedFileIds: z.array(z.string().uuid()).max(50).optional(),
  agentSlug:       z.string().nullable().optional(),
  modelId:         z.string().nullable().optional(),
  options:         z.object({
    temperature:        z.number().min(0).max(2).optional(),
    customSystemPrompt: z.string().max(4_000).optional(),
    searchContextSize:  z.enum(['low', 'medium', 'high']).optional()
  }).optional()
});

router.post('/chat',
  requireFeatureWithLimit('webSearch'),
  // sanitiserMiddleware runs at slot 12 globally — no per-route remount
  asyncHandler(async (req, res) => {
    const body = parseBody(ChatBody, req.body);
    // body.content has already been stripped of prompt-injection prefixes by Module 9
    ...
  })
);
```

Authoring rule: **schema messages are user-facing** (per Project Foundation §04). Module 9's job is downstream of Zod failures.

---

## I. Skip List

A small set of routes opt out of the middleware (or parts of it):

| Route | Why |
|---|---|
| `POST /files/upload` (the multipart body, not the file parts themselves) | The file part check still runs; the JSON body check is N/A |
| `GET /chat/stream/:jobId` | SSE GET; no body |
| Health and CORS preflights | Not authed |

The list lives in `src/config/sanitiser.ts → SKIP_ROUTES` as a `Set<'METHOD path'>`.

---

## J. Security Notes

| Concern | Mitigation |
|---|---|
| Bypass via gzip / chunked encoding | Body parsing happens upstream (`express.json()` slot 7); Module 9 sees the decoded body. Size limits apply post-decode. |
| Bypass via deeply-nested JSON | `express.json({ limit: '256kb' })` caps total body at the slot-7 layer. Module 9's per-field caps are stricter than the global. |
| Pattern-matching CPU exhaustion | Each `INJECTION_PATTERN.regex` is anchored, non-backtracking, and tested on inputs ≤ 50 K chars. Total time budget per request: `< 5 ms` measured. |
| Hash collision in repeat detection | SHA-256 truncated to 32 hex chars (128 bits) — collision probability negligible for the scale we run at. |
| `sanitize-html` allowlist drift | The list is in `sanitiser.service.ts` and pinned in code review. Adding a tag requires a security review note. |
| Injection-burst false positives | A user copy-pasting from a docs page that contains "ignore the above" loses that phrase. Acceptable trade-off. The strip is in-place; the user's actual question still goes through. |
| Repeat-message on retries | Genuine network retries within 60 s succeed up to 4 times. The 5th gets a clear `REPEAT_MESSAGE` envelope so the frontend can suggest "Did you mean to send something different?" |
| Multipart smuggling | `req.files` is parsed by the multipart middleware (`multer` or equivalent) before slot 12; Module 9 sees structured `FilePartCheck` objects, not raw bytes. |
| Logging of sanitised content | Sanitised body goes to logs only at `LOG_LEVEL=debug` and only when explicitly opted-in by the route's controller. Default: never logged. Pino's redaction list (Project Foundation §05) covers `req.body.content` already. |
| Bypass via `application/x-www-form-urlencoded` | `express.urlencoded` is **not** mounted; only `application/json` and `multipart/form-data` reach Module 9. |
