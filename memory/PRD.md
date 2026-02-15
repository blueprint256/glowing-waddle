# Campaign Management Platform - PRD

## Original Problem Statement
Create a proper Docker image in a new branch (`docker-setup`) with multi-stage Alpine-based builds for backend and frontend, with proper environment variable handling for hosted MongoDB.

## What's Been Implemented (Jan 2026)

### Docker Configuration
- **Branch:** `docker-setup` created
- **Backend Dockerfile:** Multi-stage Alpine-based build
  - Stage 1: Build TypeScript to JavaScript
  - Stage 2: Production with only runtime deps, non-root user, health checks
- **Frontend Dockerfile:** Multi-stage Alpine-based build
  - Stage 1: Build Vite/React app
  - Stage 2: Nginx Alpine for serving static files
- **docker-compose.yml:** Orchestrates both services with env var passthrough
- **nginx.conf:** SPA routing, gzip, security headers, caching
- **.env.example:** Template for all required/optional env vars
- **.dockerignore files:** Optimize build context

### Environment Variables Handled
| Variable | Service | Required |
|----------|---------|----------|
| MONGODB_URI | Backend | Yes |
| SESSION_SECRET | Backend | Yes |
| NODE_ENV | Backend | No |
| PORT | Backend | No |
| FRONTEND_URL | Backend | No |
| GOOGLE_CLIENT_ID | Backend | No |
| GOOGLE_CLIENT_SECRET | Backend | No |
| AWS_* | Backend | No |
| VITE_API_URL | Frontend | No |

### Runtime Env Injection (Frontend)
- Frontend supports runtime env injection via `env-config.js`
- Works for Docker (runtime) and Vite (build-time)

## Backlog
- P0: None
- P1: Add CI/CD pipeline for automated builds
- P2: Add Kubernetes manifests for k8s deployment
- P2: Add multi-arch builds (amd64/arm64)

## Next Tasks
1. Test Docker builds locally
2. Push images to container registry
3. Deploy to target environment
