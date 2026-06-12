# Module 1 — Auth & Identity

> Single source of truth for the authentication & identity layer of the Layer 2 API Gateway.
> Source spec: [`../../LAYER2_API_GATEWAY.md` §3](../../LAYER2_API_GATEWAY.md).

## Documents

| # | File | What's inside |
|---|---|---|
| 1 | [01_OVERVIEW.md](01_OVERVIEW.md) | Mission, responsibilities, non-goals, inputs/outputs |
| 2 | [02_FILE_STRUCTURE.md](02_FILE_STRUCTURE.md) | Every file in the module + its purpose |
| 3 | [03_DATABASE_SCHEMA.md](03_DATABASE_SCHEMA.md) | All tables, DDL, columns, indices |
| 4 | [04_ACCESS_CONTROL.md](04_ACCESS_CONTROL.md) | Roles, RBAC matrix, middleware chain, scopes |
| 5 | [05_USER_API_CONTRACTS.md](05_USER_API_CONTRACTS.md) | All `/api/v1/auth/*` endpoints |
| 6 | [06_ADMIN_API_CONTRACTS.md](06_ADMIN_API_CONTRACTS.md) | All `/api/v1/admin/auth/*` endpoints |
| 7 | [07_FLOWS.md](07_FLOWS.md) | Sequence diagrams for every auth flow |
| 8 | [08_SECURITY.md](08_SECURITY.md) | Hashing, JWT, rotation, brute-force, MFA |
| 9 | [09_DEPENDENCIES.md](09_DEPENDENCIES.md) | Inter-module contracts and emitted events |
| 10 | [MODULE1_STATUS_REPORT.md](MODULE1_STATUS_REPORT.md) | Module implementation and contract tracking status |
| — | [MODULE1_VISUAL.html](MODULE1_VISUAL.html) | Visual diagram (open in browser) |

## Reading Order

If you are new to the module: **01 → 04 → 07 → 02 → 03 → 05 → 06 → 08 → 09**.
If you are implementing: **02 → 03 → 05 → 06 → 04 → 08 → 07 → 09**.

## Status

- **Stage:** Planning complete / implementation in progress
- **Owner:** Backend
- **Last updated:** 2026-04-28

## Current Implementation Focus

- Finalize runtime foundation for Module 1 development using containerized local services.
- Keep Module 1 contracts as source of truth while route/controller/service code is implemented.
- Track implementation delta and live route exposure in `MODULE1_STATUS_REPORT.md`.
