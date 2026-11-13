# Content Hub (Part two)

The platform has two parts. A System Admin chooses, per user, which part(s) they can use.

| Access mode | Meaning |
|---|---|
| `both` (default) | No restriction — existing users are unaffected |
| `part_one` | Full campaign suite only (campaigns, projects, tasks, calendar, sheets, AI tools, settings) |
| `part_two` | Content Hub only |

System Admins always have both parts. Set it in **Users → (user) → Platform Access**, or when creating a user.

**Enforcement is in two places:** the API answers `403 ACCESS_RESTRICTED` for areas a user may not use
(`middleware/access.ts`, mounted in `server.ts`), and the app hides/redirects (`RequirePart` in `App.tsx`, nav filtering
in `DashboardLayout.tsx`). A Part-two-only user lands on `/hub`; a Part-one-only user never sees it.

## Concepts

- **Hub project** – owned by one user; independent of campaigns (`HubProject`).
- **Slot** – a named place for one image. Filled through a **one-time upload link**.
- **Pending request** – the link: single-use, 15 minutes, auto-deleted by a MongoDB TTL index.
- **Hub asset** – uploaded image or rendered poster (`HubAsset`, private storage; separate from Part one's `Asset`).
- **Version** – a numbered, immutable poster: the structured data **and** the PNG the server rendered from it.

## Flow

1. Create a project → add slots.
2. On a slot press **Upload link** → open the link on any device (no login): drop, paste or pick an image.
3. Compose a poster from slot images and text layers → the server renders a PNG and stores it as version *N*.
4. To change a poster, **Edit as a new version**; older versions are kept.

## API (all under `/api/hub`; session login + Part-two access unless noted)

| Method & path | Purpose |
|---|---|
| `POST /projects`, `GET /projects`, `GET/PUT /projects/:id` | Project CRUD (owner or System Admin) |
| `POST/GET /projects/:id/slots`, `GET/DELETE /projects/:id/slots/:slotId` | Slots |
| `POST /projects/:id/slots/:slotId/request-upload` | Issue a one-time link → `{ uploadUrl, pageUrl, expiresAt }` (re-requesting revokes the old link) |
| `GET /upload/info?token=` | **Public.** What a link is for (slot + project name, expiry) |
| `POST /upload?token=` | **Public.** Multipart field `file`; PNG/JPEG/WebP/GIF ≤ 20 MB; token is the credential and is consumed atomically |
| `POST /projects/:id/versions` | Body `{ structuredData }` → renders and saves the next version |
| `GET /projects/:id/versions`, `GET /projects/:id/versions/:number` | Versions |
| `GET /assets/:id`, `/assets/:id/content`, `/assets/:id/url` | Asset details; redirect / JSON of a 5-minute signed URL |

`structuredData`: `{ width, height, background?, layers: [ {type:"image", assetId, x, y, width, height} | {type:"text", text, fontSize?, color?, font?, x, y} ] }`
(≤ 4096 px per side, ≤ 50 layers; image layers may only use the owner's own assets).

## Design decisions

- **Namespaced under `/api/hub`** so hub "projects" never collide with campaign-suite projects.
- **Separate `HubAsset`/`HubProject` models**: Part one's `Asset` is untouched, so the two parts cannot break each other.
- **API-first**: the UI uses the same endpoints a future AI connector would call; connectors only need to wrap these.
- **Private storage + signed URLs**; guest uploads are validated by decoding the bytes, not by trusting the declared type.

## Configuration

`FRONTEND_URL` (backend) is used to build the human upload link (`<FRONTEND_URL>/upload?token=…`).
Existing AWS settings are reused. Run `npm install` in `backend/` once (adds `sharp`).

## Not built yet

AI connectors (MCP etc.), browser extension / share-sheet routes, QR hand-off, Unsorted inbox, project rename UI,
automated tests. The poster composer is form-based with an approximate preview (no drag-and-drop canvas yet).
