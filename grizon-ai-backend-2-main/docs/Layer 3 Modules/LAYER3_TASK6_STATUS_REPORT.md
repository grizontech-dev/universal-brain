# Layer 3 Task 6 (P3) — Infrastructure — Status Report

**Last updated:** 2026-05-09  
**Plan:** `LAYER3_TASK6_PLAN_P3_INFRASTRUCTURE.md` (adapted: AWS S3 instead of Cloudflare R2; notifications aligned to Module 7 payload)

## Delivered

| Area | Notes |
|------|--------|
| Artifact storage | `src/artifacts/artifact.storage.ts` — `LocalArtifactStorage` + `S3ArtifactStorage` (`PutObject` / `GetObject` / `DeleteObject`, presigned GET via `@aws-sdk/s3-request-presigner`). |
| Shared S3 client | `src/infra/s3.client.ts` — `createS3Client()`, `getS3BucketName()`. |
| User uploads + ingestion | `src/services/storage.service.ts` — `write()` and `readUploadedBytes()`; S3 keys under `uploads/<userId>/…`. `src/workers/file.worker.ts` reads via `storageService` (supports `STORAGE_DRIVER=s3`). |
| Env | `STORAGE_DRIVER=local \| s3`; `S3_BUCKET`, `AWS_REGION`; optional `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Removed `R2_*` / `r2` driver. |
| Queue metrics helper | `src/queues/queueMetrics.ts` — shared BullMQ counts for queues controller + system health. |
| Notifications | `src/notifications/templates.ts` — HTML + plain text for all six `NotificationJobPayload` templates; escaped HTML for dynamic fields. `notification.worker.ts` maps templates; respects `channels` (empty ⇒ email). |
| Mailer | `src/infra/mailer.ts` — optional `html` on `MailMessage`; `sendHtml()` helper. |
| Judge0 | `src/tools/codeExecution.tool.ts` — nine languages + `c++` alias; exported `normaliseJudge0Language` / `SUPPORTED_CODE_LANGUAGES`. |
| Admin health | `GET /api/v1/admin/system/health` — Postgres ping, Redis ping, BullMQ queue counts, `providerHealth.snapshot()` (existing Redis-backed circuit breaker). |
| Postman | `Module 7 - Admin Queues Contracts`: added **System Health - GET /api/v1/admin/system/health**. |

## Dependencies added

`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

## Operational notes

- **Production S3:** Set `STORAGE_DRIVER=s3`, `S3_BUCKET`, `AWS_REGION`. Omit explicit keys when using IAM/task/instance roles.
- **Local:** `STORAGE_DRIVER=local`, `LOCAL_UPLOADS_DIR=./uploads` — artifacts under `uploads/artifacts`, user uploads under `uploads/<userId>/…`.
- **Provider health:** No `src/models/health.ts`; continues to use `src/router/providerHealth.ts` as in the codebase checkpoint.

## Divergence from original P3 plan doc

- Storage is **Amazon S3**, not Cloudflare R2 (`STORAGE_DRIVER=s3`, not `r2`).
- Notification templates match **`NotificationJobPayload`** (Module 7), not the four chat-job event names listed in the older plan prose.
