# Swagger Update Instructions (Backend)

## Purpose
Keep API documentation accurate after every backend implementation change.

## Rule
After any backend API change, you must update Swagger/OpenAPI before merging.

This includes:
- New endpoints
- Modified request body/query/path parameters
- Changed response payloads
- Added/removed auth requirements
- New error responses or status codes

## Files To Update
- `backend/src/openapi.js`
- `backend/src/app.js` (only if Swagger/OpenAPI routes need wiring changes)

## Required Workflow
1. Implement backend API change.
2. Update OpenAPI spec in `backend/src/openapi.js`:
   - Path
   - Method
   - Parameters
   - Request schema
   - Response schema/examples
   - Error cases
3. If needed, confirm Swagger routes are mounted in `backend/src/app.js`:
   - `/openapi.json`
   - `/api/openapi.json`
   - `/swagger.json`
   - `/swagger-ui`
4. Validate backend has no diagnostics errors.
5. Manually verify Swagger UI reflects the new API behavior.

## Definition Of Done
A backend API task is not complete unless:
- OpenAPI spec is updated
- Swagger UI shows the latest endpoint contract
- Request/response examples match real backend behavior

## Quick Verification Checklist
- Endpoint appears in Swagger UI
- Example request matches controller validation
- Response fields and types are correct
- Auth requirement is correct (Bearer/session expectations)
- 4xx/5xx responses are documented

## Suggested PR Note Template
- Updated backend implementation
- Updated `backend/src/openapi.js`
- Verified `/swagger-ui` renders updated endpoint
- Verified request/response examples against actual route behavior
