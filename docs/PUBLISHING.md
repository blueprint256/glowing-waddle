# Publishing (and Edit in Canva)

Blueprint can publish a task's caption and pictures/video to **X, LinkedIn, Facebook Pages, Instagram, TikTok and YouTube**, now or on a schedule. The engine is complete. Each platform is switched on **from Settings, without code changes**, once that platform has approved your app.

Until then:

- **Post by hand** works for every platform with no approvals. The post is scheduled as a reminder. When it's due, it appears under *Needs attention* with the caption to copy and the files to download, and a "Mark as posted" button that saves the live link.
- **Test accounts** (test mode) run the whole flow without posting anything. Use them for demos and to record the review videos platforms ask for. A caption containing `#fail` fails on purpose so the failure path can be shown too.

## Where things are

| | |
|---|---|
| **Task page → Publishing → Publish** | Choose accounts and/or "post by hand", caption (defaults to the task content), files (task image, attached images, Library items linked to the task), and when: now, scheduled, or draft. Each platform's rules are checked live. |
| **Sidebar → Publishing** | Upcoming, Needs attention (failed or due to post by hand), Published, Drafts, Accounts (connect, reconnect, disconnect, test accounts). |
| **Settings → Integrations → Publishing & Canva** (System Admin) | Global on/off, test mode, and per-platform app keys, each with the callback URL to register. |
| **Admin → Users → (user) → Publishing** | Per-user on/off. |
| **Blue and the Claude connector** | `list_publishing_channels`, `schedule_post`, `list_posts`, `cancel_post`. Assistants confirm the accounts, caption and time before posting. |

## Switching a platform on (the "few clicks")

1. Create the developer app on the platform; the links are in the settings card.
2. Register the **callback URL** shown in the card, `<MCP_PUBLIC_URL>/api/publishing/oauth/<platform>/callback`. `MCP_PUBLIC_URL` must be your public https address.
3. Request the products/permissions below and pass the platform's review.
4. Paste the client ID and secret into the card, switch it on, and save.
5. Users go to Publishing → Accounts → Connect.

| Platform | Developer app | What to request | Before approval |
|---|---|---|---|
| **X** | developer.x.com, OAuth 2.0, "Web App" (confidential client) | Scopes `tweet.read tweet.write users.read media.write offline.access`. No review; prepaid pay-per-use credits. | Works fully, billed per post. |
| **LinkedIn** | linkedin.com/developers, app verified by your LinkedIn Page | "Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect" (self-serve) for personal profiles. **Community Management API** (reviewed) for company pages; then switch on "Company pages" in the card. | Personal profiles work. |
| **Facebook + Instagram** | developers.facebook.com, Business app, Facebook Login for Business | Business Verification, then App Review for `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `business_management`, `instagram_basic`, `instagram_content_publish`. Instagram accounts must be Business/Creator and linked to a Facebook Page. | Only Pages/accounts of people with a role on the app. |
| **TikTok** | developers.tiktok.com | Login Kit + Content Posting API (Direct Post), scopes `user.info.basic video.publish video.upload`. App review, then the **content posting audit**. | Posts are private (only the creator sees them), max 5 users a day. Posts made before the audit stay private. |
| **YouTube** | console.cloud.google.com, YouTube Data API v3, OAuth "Web application" | OAuth consent-screen verification (more than 100 users), then the **YouTube API compliance audit**. | Uploads are private; up to 100 test users. |

Optional fields: LinkedIn API version (default: the version from two months ago, computed automatically) and Meta Graph API version (default `v24.0`). Raise them if a platform retires an old version.

### TikTok's posting-screen requirements (already built)

The TikTok audit checks the posting screen. The publish dialog already:

- shows the creator's name
- fetches the creator's live settings
- makes the user choose who can see the post from the creator's own options, with no default
- respects comments, Duet and Stitch that the creator has disabled
- includes the commercial-content disclosure ("your brand" / "branded content"), and blocks private branded content
- shows the Music Usage Confirmation (and Branded Content Policy) consent text
- shows a preview of the files

## How publishing works

```
Publish dialog ─▶ rules check per platform ─▶ SocialPost (one per destination, shared groupId)
                                                │
scheduler (in the API, every 10 s, 2 at a time) ┘─▶ claim atomically ─▶ refresh sign-in if needed
   ─▶ read files from storage in chunks (videos never fully in memory) ─▶ platform plug-in ─▶ published + link
```

- **Retries:** network errors, platform outages and rate limits are retried twice (after 1 and 5 minutes).
- **Expired sign-ins:** the account is marked "Needs reconnecting" and the post fails with a clear message.
- **No duplicates:** if a server stops mid-upload, the post is marked failed ("check before retrying") instead of being re-posted blindly.
- **Platforms that process after upload (TikTok):** the post shows "Processing…" until the platform confirms.
- **Instagram:** gets JPEG copies of PNG/WebP pictures automatically. Pictures must be between 4:5 and 1.91:1, and the dialog says so before scheduling.
- **Security:** sign-in tokens and app secrets are stored encrypted (AES-256-GCM, from `ENCRYPTION_KEY`, so **set a strong `ENCRYPTION_KEY` in production and keep it**). Connecting uses PKCE where the platform supports it, and a one-time state record. Files go to platforms as short-lived signed links.
- **Several API servers:** they can run at the same time, because jobs are claimed atomically. Set `PUBLISHING_WORKER=off` on instances that shouldn't schedule.

### Adding a platform later

Write one plug-in in `backend/src/publishing/platforms/` that implements `ProviderAdapter` (sign-in URL, code exchange, account discovery, refresh, publish, optional status check). Then add one line in `registry.ts` and the platform's rules in `rules.ts`. The screens, scheduler, retries, settings card, assistants and tests pick it up automatically.

## Edit in Canva

**Edit in Canva** appears on task images and Library pictures once a System Admin adds the Canva app keys:

1. The picture is uploaded to the user's own Canva and opened as a new design in a new tab.
2. Canva's "Return to Blueprint" button, or **Bring back from Canva** in the app, exports the design.
3. The design is saved as the **next Library version**, or as the new task image, which also becomes a Library version.

All editing happens on Canva's servers; Blueprint only sends and receives one image.

Setup (Settings → Integrations → Publishing & Canva → Canva):

1. Create an integration at canva.com/developers. Turn on the REST/Connect APIs with the scopes `asset:read asset:write design:meta:read design:content:read design:content:write profile:read`.
2. Add the **Redirect URL** and turn on **Return navigation** with the **Return URL** shown in the card. For local testing Canva accepts `http://127.0.0.1:<port>` addresses (not `localhost`).
3. Paste the client ID and secret. In draft it works for your own Canva team. Submit it for Canva's review so everyone can connect.

Each user connects their own Canva account (Settings → Integrations → Canva, or automatically the first time they press Edit in Canva). The old demo connection is no longer treated as connected.

## Limits and notes

- The plug-ins follow each platform's current documentation, but they have not yet run against the live platforms. Expect small adjustments on first connection, and test each platform with your own accounts before clients use it.
- TikTok photo posts are not included: TikTok fetches photos only from a domain you verify with them. Videos are uploaded directly and work.
- LinkedIn sign-ins last 60 days unless LinkedIn grants refresh tokens; users get "Needs reconnecting" when it expires.
- Scheduled posts don't show on the Calendar page yet. They're on the Publishing page and each task's page.

## Tests

`npm run publishing:selftest` (backend) covers 13 groups of checks with no database or network:

- platform rules (lengths, media, ratios, hashtags, video/title requirements)
- encryption and PKCE
- the exact requests each plug-in sends (X, LinkedIn, Facebook, Instagram, TikTok chunks and status, YouTube resumable upload)
- error classification
- test channels
- Canva helpers
- the assistant tools
