# Project Foundation

Cross-cutting conventions every module of this codebase must follow. Anything in here is non-negotiable — it's how requests look, how errors look, how things are logged, and how the project is organised on disk.

## Documents

| # | File | What's inside |
|---|---|---|
| 1 | [01_PROJECT_SETUP.md](01_PROJECT_SETUP.md) | Local dev, env vars, scripts, Docker, EasyPanel deploy |
| 2 | [02_FOLDER_STRUCTURE.md](02_FOLDER_STRUCTURE.md) | Project-wide `src/` layout and naming rules |
| 3 | [03_REQUEST_RESPONSE.md](03_REQUEST_RESPONSE.md) | Universal envelope · success + error shape · headers |
| 4 | [04_ERROR_HANDLING.md](04_ERROR_HANDLING.md) | `AppError` class · code catalogue · `message` for users |
| 5 | [05_LOGGING.md](05_LOGGING.md) | Pino setup · levels · request log · redaction |

Read in order; each doc assumes the previous one.

## Status

- **Stage:** Pre-implementation spec
- **Last updated:** 2026-04-28
