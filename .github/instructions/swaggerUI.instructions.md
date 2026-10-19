---
applyTo: "backend/src/**/*.js"
---

After every backend API implementation change, update Swagger/OpenAPI in the same change.

Required actions:
- Update endpoint definitions in backend/src/openapi.js.
- Keep request, response, status codes, auth requirements, and examples aligned with real route behavior.
- If route exposure changed, verify swagger/openapi mounts in backend/src/app.js remain correct.

Definition of done for backend API work:
- OpenAPI spec is updated.
- Swagger UI reflects the latest API contract.
- Added/changed error responses are documented.
