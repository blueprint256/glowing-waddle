# System review (Inbox branch)

A full pass over how the features connect, done while building the Inbox. What was found and what changed:

## Things that could go wrong between features (fixed)

| Problem | Fix |
|---|---|
| Deleting a task left its scheduled posts in place, so they would still go out. Library items kept a link to the missing task, and open Canva edits pointed at it. | `services/lifecycle.ts → onTaskDeleted`: posts that haven't gone out are cancelled (with the reason), Library items are unlinked from the task (files kept), and open Canva edits are closed. The user is told how many posts were cancelled. |
| Archiving (or "deleting", which archives) a campaign left its scheduled posts going out. | `onCampaignArchived` cancels them; the response says how many. |
| A deactivated user's scheduled posts kept running, then failed one by one. | `onUserDeactivated` cancels them, from both the deactivate button and the edit form. |
| Failed posts, posts due by hand and expired accounts were only visible if the user opened the Publishing page. | They now arrive in the Inbox (Needs action) and close themselves when dealt with. |
| Scheduled posts didn't appear on the Calendar. | The Calendar shows posts (dashed, coloured by status) with a "Show posts" switch; clicking one opens its task. |

## Correctness (fixed)

| Problem | Fix |
|---|---|
| The Calendar and several task-date displays showed the day **before** the task date for users west of UTC. Task dates are stored as midnight UTC and were converted to local time. | Dates are shown on their stored calendar day (Calendar, Dashboard, task page, social previews). |
| Dashboard "Recent tasks" showed the 5 tasks with the **earliest** dates (it loaded up to 1,000 tasks to do so), and its third card counted those 5. | The task list accepts `sort=recent`; the Dashboard asks for the newest 5. The third card is now **Needs your attention** (Inbox counts and scheduled posts). |
| List endpoints accepted any `limit` (the Calendar asked for 10,000) and negative pages. | Limits are capped at 5,000 and pages start at 1. |
| When a session expired, every screen showed its own error. | Any 401 triggers one sign-in check, which sends the user to the login page. |
| Unknown addresses showed an empty page. | They redirect to the Dashboard. |
| Admin pages rendered (empty) for non-admins who typed the address. The server already refused the data. | Admin pages redirect non-admins to the Dashboard. |

## Security and operations

- **Startup warning in production** when `SESSION_SECRET` or `ENCRYPTION_KEY` are still the development defaults, or `MCP_PUBLIC_URL` is missing. It's not fatal, so a running deployment isn't broken.
- **Database index** on campaign owner + archived + date, which is used by every ownership check and "my campaigns" list.
- **Checked:** every new route checks ownership on the server (Inbox items by recipient, conversations by user, Outreach admin-only). Assistants confirm before publishing or acting on Inbox items. Platform tokens and app secrets are encrypted.

## Noted, not changed

- The backend logs a lot of debug detail (S3 uploads, AI poster generation). No secrets are printed, but production logs are noisy. Worth trimming in a later clean-up.
- The frontend can't be type-checked or built here (packages can't be installed in this environment). Run `npm run build` in `frontend/` before deploying.
