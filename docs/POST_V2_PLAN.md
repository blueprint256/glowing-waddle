# Post v2 (branch `planner-v2`)

The post is the centre of Blueprint. This round makes it one screen, removes themes, and gives
pictures a proper flow (create with references, change with words, versions, tidy storage).

## Decisions (18 Nov 2026)

1. **No more themes.** A post belongs to a campaign, or to no campaign ("everyday content").
   Campaigns are just a flexible way to group posts.
2. **One post screen** for new and existing posts. "+" on a day and "New post" open it directly
   (unsaved until Create). The small "new post" form goes away.
3. **Fields**: title (automatic from the caption, click to rename) · campaign (optional) · day ·
   status · **What's this post about?** (the brief, optional, at the top: what both AI features
   read) · picture · caption · Publishing. Removed from the screen: Notes (comments), Improve
   brief, the separate reference images section, theme.
4. **Two AI actions on a post**: Caption (Write caption / Improve caption) and Picture (Create
   image / Change image).
5. **Picture flow**
   - *Create image*: uses "What's this post about?" (asks for a description if empty), the brand,
     the campaign, and the post's **reference pictures**, each with a role:
     - *Include this* (product photo, a place, a person)
     - *Copy this style* (a poster you liked: layout, colours, mood; never its words, logos or people)
   - *Add my logo*: the AI leaves clean space and the app stamps the real logo file in the corner
     you choose (exact, never redrawn).
   - Size: square, portrait or landscape.
   - *Change image*: a sentence ("replace the mountain with a soft waterfall"); edits the picture
     you're looking at, keeping everything else.
   - Results are **drafts** shown side by side with the current picture: *Use this*, *Change again*,
     *Discard*. "Try again" is now *New image* (starts over).
6. **Storage**
   - Unpicked AI drafts are deleted after **7 days** (and straight away when discarded).
   - Each post keeps its current picture plus the **3 before it (4 in all)**; older ones are deleted
     unless something still uses them (a scheduled or published copy, another post).
   - What was published is never deleted (it's referenced by Publishing).
   - AI pictures are saved as high-quality JPEG instead of PNG (about 5–8× smaller).
   - The post's Library item keeps the same 4 versions.

## Data

`Task` (a post) gains:

- `ownerId`: the account the post belongs to (was always "the campaign's owner"; now needed
  because a post may have no campaign). Set at creation; filled in for old posts at start-up.
- `campaignId`: optional. `projectId`: kept in old records but no longer used.
- `legacyTheme`: the old theme's name, kept quietly so nothing is lost.
- `imageHistory`: up to 3 earlier pictures `{ url, source, note, at }`.
- `aiDrafts`: unpicked AI pictures `{ id, url, kind: create|change, prompt, from, size, at }`.
- `references`: `{ id, url, role: include|style, name, at }` (up to 6).
- `name` may be left empty by people: it's filled in from the caption or brief.

Ownership checks, lists and filters use `ownerId` (not the campaign) everywhere: post routes,
Publishing, Library links, AI context, comments, the connector and Blue.

## API (posts)

- `POST /api/tasks` `{ campaignId?, name?, description?, content?, taskDate?, status?, ownerId? }`
- `GET /api/tasks?campaignId=none` → posts without a campaign
- `PUT /api/tasks/:id` accepts `campaignId` (id or null) to move a post
- `POST /api/tasks/:id/image/create` `{ description?, size?, logo? }`
- `POST /api/tasks/:id/image/change` `{ instruction, from?, logo? }`
- `POST /api/tasks/:id/image/use` `{ url }` (a draft or an earlier picture)
- `DELETE /api/tasks/:id/image/drafts/:draftId`
- `POST /api/tasks/:id/references` (file upload, or `{ libraryAssetId }`) · `PATCH|DELETE /api/tasks/:id/references/:refId`
- Older endpoints keep working: `generate-poster` (= create), `adopt-poster` (= use the newest
  draft), `discard-poster` (= discard the newest draft).

## Screens touched

Post editor (rebuilt), Planner (no theme filter/grouping; "No campaign"), Today, Campaigns and the
campaign page (no themes), Plan with AI (a list of posts, no themes), Blue (no theme panel, cards),
search, Library item links, old `/projects/<id>` links (→ the campaign).

## Done (branch `planner-v2`)

Everything above is built. Notes from building it:

- Old posts are moved at start-up (owner, old theme name, reference pictures). It's safe to run
  again and logs one line: `[posts] Moved to Post v2: …`.
- The admin's own `generate-poster` command still works for Create image; reference pictures are
  always sent with it. A `change-image` command (one prompt) can replace the built-in Change words.
  New placeholders: `{references}`, `{format}`, `{logoNote}`.
- Captions can be written with AI on a new post before it's created (`POST /api/tasks/improve-caption`).
- A campaign can be deleted while keeping its posts (Campaign page › ⋯ › Delete campaign, keep its posts).
- The Planner tray has a "Quick idea" box (saved at once as an Idea without a day).
- Unused AI pictures are swept hourly by the publishing worker (`PUBLISHING_WORKER=off` stops it).

## How to check

1. `cd backend && npm run build && npm run dev`, `cd frontend && npm run build && npm run dev`.
2. Start-up log: one `[posts] Moved to Post v2` line the first time (none afterwards).
3. Planner › New post (or "+" on a day): the full post screen opens, "New post · not saved yet".
   Type a caption: the title follows it. Create post: the address gets the post's id, nothing reloads.
4. Campaign picker: "No campaign", then your campaigns. Change it on a saved post: saved at once, Undo works.
5. Picture: Upload, then Replace: the first picture appears under the clock icon (Earlier). Click it,
   Bring this back. Upload 4 more: only 3 earlier pictures stay.
6. Create with AI (AI on): add a product photo (Include this) and a poster (Copy this style), Portrait,
   Add my logo bottom-right, Create image. The draft shows next to the current picture with
   "AI picture · not used yet"; the logo is crisp in the corner; the file is a 1024×1280 JPEG.
7. Type a change ("make the background a sunset"), Change: a second draft, the rest kept. Use this picture.
8. Discard a draft: it disappears (and its file is deleted).
9. Planner › filter Campaign › No campaign; List › By campaign shows "No campaign" last.
10. Delete a post: its pictures go unless a scheduled/published copy uses them; Library copies stay.
11. Self-tests: `npx tsx src/scripts/postsSelfTest.ts` (19), `mcpSelfTest` (32), `blueSelfTest` (16),
    `librarySelfTest` (11), `publishingSelfTest` (13), `inboxSelfTest` (5).
