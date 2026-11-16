# Library (Aggregator)

The Library is a private, searchable home for everything a client has made: posters, photos, logos, captions, drafts, documents, videos. It is built so that a person, Blue, or Claude (through the connector) can ask for "the poster we did for Women's Day, around March two years ago" and get it straight away.

User-facing name: **Library** (sidebar, between Tasks Sheet and Settings). Feature/admin name: **Aggregator**.

## What users can do

- **Upload** single files, many files, whole folders (folder structure is kept and searchable) or **zip files** (expanded on the server). Drag and drop works on the whole Library page. Files up to 200 MB each.
- **Import from app**: brings in images already in the app (task posters and attachments, company logos, older uploaded assets), linked to their task, project and campaign.
- **Browse** with the timeline tree: years → months → events, with counts. Filter by type, kind of work (poster, social post, photo, logo …), date and event.
- **Search** by words in titles, AI descriptions, text inside images, captions, tags, events, file and folder names; partial words work; and, with an OpenAI key, **by meaning** ("pink celebration poster" finds a Women's Day poster even if those words aren't in it).
- **Versions**: every item has a full history. Upload a new version, download any version, or make an older one current again (the restore is added as a new version, so nothing is ever lost). New images on a task (uploaded or an adopted AI poster) automatically become the next version of that task's Library item.
- **Review**: when an upload looks like a new version of something already there (same image, edited), it is flagged under *Needs review* with "Make it a new version" / "Keep separate". Exact duplicates are recognised and never stored twice.
- **Edit** title, description, date, event, tags, notes, and link the item to a campaign (Blue can link it to a specific task).
- **Make this a past campaign**: with an event selected, one click creates a *completed* campaign dated from the items and links them to it. Items stay in the Library.
- **Trash**: deleted items can be restored for 30 days, then they are removed for good (files included).

## How it works

```
upload ─▶ temp file on disk ─▶ sha256 (exact duplicate?) ─▶ private S3: original + webp thumbnail + small JPEG for the AI
                                   │                                │
                                   └─ image fingerprint (dHash) ────┴─▶ "looks like a version of …" review suggestion
                                                                    ▼
                    LibraryAsset (the item)  +  LibraryVersion (immutable, one per file)  +  LibraryJob (queue)
                                                                    ▼
                    worker (in the API process, MongoDB-backed queue) ─▶ AI reads the item once ─▶ title, kind of work,
                    description, text in image, tags, event, date, colours, language ─▶ search text (+ meaning vector)
```

- **Dates**: taken from the photo's EXIF data first, then the file name (`2023-03-08-poster.png`, `IMG_20230308…`), then what the AI reads in the content ("8 March 2023"), then the file's own modified date, then the upload date. The item page shows where the date came from; a date the user sets always wins.
- **Text**: read from txt/md/csv/json/html, Word (.docx) and PowerPoint (.pptx) files without AI; PDFs are read by the AI (Anthropic) when configured.
- **Index**: a weighted MongoDB text index (title > event > tags > everything else), a partial-word fallback, and optional embeddings (OpenAI `text-embedding-3-small`), merged by rank. The timeline overview is one aggregation, cached for 30 seconds per user.
- **Files are private**: Library objects are stored without public access. The app serves them through short-lived signed links (`/api/library/items/:id/file` redirects), and thumbnails are cache-friendly.
- **Jobs**: claimed atomically, 2 at a time, retried 3 times with back-off; stuck jobs are recovered; finished job records expire after 40 days. Trash older than 30 days is purged automatically.

## Admin settings

**Settings → LLM Settings → Library (Aggregator)** (System Admin):

| Setting | Default | Notes |
|---|---|---|
| On/off for everyone | On | Off hides the Library everywhere; files are kept. |
| AI that reads uploads | Automatic (follows Blue) | Anthropic, OpenAI or Grok; the model must read images. A small model is plenty. |
| AI-read items per user per month | 500 | Over the limit, items are still stored and searchable by name, folder and text. 0 = unlimited. |
| Search by meaning | On (needs an OpenAI key) | Very low cost. |

**Admin → Users → (user) → Library** switches it off for one person. The connector's `update_user` tool accepts `library_enabled` too.

AI reading works in both Part one and Part two (it reads uploads; it does not generate images). Usage is logged under "Library analysis" with the other AI usage.

## Privacy

Only the owner sees their Library. System Admins can open another user's Library through the API (`?ownerId=`) for support. Every upload and deletion is in the audit log.

## Blue and Claude

Six tools are available when the Library is on for the user: `library_overview` (the timeline table of contents), `search_library`, `get_library_item`, `update_library_item`, `restore_library_version`, and `delete_library_item` (asks for confirmation). Blue is told to read the overview first and turn "around March" or "two years ago" into a date range; search results are shown in Blue as an image gallery.

Uploading images *through* Claude is not supported yet (planned).

## API

All routes are under `/api/library` and need a signed-in user with Library access.

| Method & path | What it does |
|---|---|
| `GET /status` | Available? AI on? Monthly allowance used. |
| `GET /overview` | Timeline tree and totals. |
| `GET /items` | Search: `q, kind, category, event, tags, from, to, campaignId, projectId, taskId, needsReview, trash, batchId, sort, page, limit`. |
| `POST /uploads` | Multipart `files[]` plus `relativePaths`/`lastModified` (JSON arrays), `batchId`, optional `event`, `tags`, `campaignId`/`projectId`/`taskId`. |
| `GET /imports/:batchId` | Progress of an upload batch (AI reading). |
| `POST /import-app` | Import task images, logos and older assets. |
| `GET/PATCH /items/:id` | One item with versions / edit it. |
| `GET /items/:id/file?variant=thumb\|download&version=` | Redirect to a signed link. |
| `POST /items/:id/versions` | Upload a new version (`file`, `note`). |
| `POST /items/:id/versions/:versionId/restore` | Make an older version current. |
| `POST /items/:id/reanalyze` | Read again with AI. |
| `POST /items/:id/review` | `{ action: "merge" \| "keep" }`. |
| `DELETE /items/:id` · `POST /items/:id/restore` · `DELETE /items/:id/permanent` | Trash, restore, delete for good (only from the trash). |
| `POST /collections/campaign` | `{ event, year? }` → completed campaign from an event. |
| `GET/PATCH /settings` | Admin settings. |

## Deploying

1. `npm install` in `backend/` (adds **sharp** for thumbnails and image fingerprints).
2. Make sure the S3 bucket does **not** make `library/…` objects public (no public-read bucket policy on that prefix). The app only ever hands out signed links.
3. The API's general rate limit is now 1500 requests per IP per 15 minutes (was 100, too low for normal use) and Library file links are exempt. Override with `API_RATE_LIMIT_PER_15_MIN`.
4. The worker starts with the API. If you run several API instances, they share the queue safely.

## Tests

`npm run library:selftest` (backend) checks the zip reader, text extraction, date detection, EXIF, image fingerprints and similarity, AI-reply parsing, search ranking, the timeline, the AI request formats and the Library tools. It needs no database or network.
