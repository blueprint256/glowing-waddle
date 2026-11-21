# Inbox and Outreach

**Inbox** (every user, sidebar → Inbox, with a count badge) is where the app and the Blueprint team talk to each user. Items can be answered right there.

**Outreach** (System Admins, sidebar → Outreach) is where admins send messages to chosen users, see what they did with them, answer support conversations, and keep templates.

## What users see

Three tabs:

| Tab | What lands there |
|---|---|
| **Needs action** | Posts due to be posted by hand, failed posts, accounts that need reconnecting, Library items to review |
| **Updates** | Posts going out within 24 hours (with *Publish now / Keep the schedule*), messages from the Blueprint team, the monthly AI allowance |
| **Messages** | Conversations with the Blueprint team (support questions and replies to announcements) |

Each item has buttons, for example *Mark as posted*, *Try again*, *Publish now* or *Create a post from this*. Users can also **type a reply**:

- "yes", "ok, go ahead" → the main button
- "no", "not now", "keep it" → keep or close
- "remind me later" → snooze for an hour
- pasting the live post's link → *Mark as posted* with that link
- typing a button's text ("Don't post it", "Try again") → that button

When a reply isn't one of these, Blue's AI is asked which button it means. It can only choose among that item's own buttons, and the usage is logged as "Inbox reply". If it still isn't clear, the user is asked to use a button.

Typing a reply to a message from the Blueprint team opens a conversation with the admins.

**Reminders close themselves.** Every reminder points at the real thing behind it (a post, an account, Library reviews). Once that's dealt with anywhere in the app, the reminder is marked finished within a minute. If a post is published from the task page, its "goes out tomorrow" reminder disappears.

**Other controls:**
- **Message support** starts a conversation.
- **Reminder settings** turns off the day-before reminders. Failed posts, posts due by hand, reconnects and admin messages always appear.
- **Show finished** shows closed items, which are kept for 120 days.

## What admins see (Outreach)

- **Overview:** open and unanswered support conversations, scheduled messages, and totals of what users have waiting (e.g. "3 failed posts (2 users)"). These are totals only; admins don't see users' own reminders.
- **New message:**
  - title, message, and kind (announcement, upcoming day/event, tip, news & trends, billing)
  - **who gets it:** everyone, or filters by **sector** (from company info), **tags**, and **Part one/Part two**, plus specific users by name, with a live count of recipients
  - **send now, schedule, or save as a draft**
  - optional **"Create a post from this"**, which opens Blue to draft a post in that user's brand voice from their company info
  - whether replies are allowed
  - preview, and **save as template**
- **Sent & scheduled:** each message with received / read / acted / replies. Send a draft now, cancel a scheduled message, or **withdraw** a sent message from everyone's Inbox.
- **Support:** a shared queue, unanswered first. Reply, mark resolved or reopen. Users see admin replies in Messages with a badge.
- **Templates:** reusable messages (invoice reminder, welcome note…). Use one to start a new message.

**Tags** are set per user in Admin → Users → (user) → Tags. They're lower-case labels like `pharmacy`, `nutrition` or `vip`, and only admins see them.

## Blue and Claude

- `list_inbox` shows what needs the user, with each item's actions.
- `inbox_action` runs one action.

Both assistants confirm before running an action, because some actions publish publicly. Ask "what needs my attention?".

## How it works

- `InboxItem`: one per user per item. `dedupeKey` stops the same reminder being created twice, and reminders the user closed aren't reopened.
- **Reminder rules** (`backend/src/inbox/rules.ts`) run every minute in the API: upcoming posts, posts due by hand, failed posts, accounts to reconnect, Library reviews (one weekly summary), AI allowance, scheduled admin messages and housekeeping. They read the real data, so the Inbox can't drift out of sync. Set `INBOX_WORKER=off` on server instances that shouldn't run them.
- **Admin messages** are delivered in batches of 500 when sent. Sending twice is harmless, and a failed send is retried in 5 minutes.
- **Conversations** (`SupportThread`) keep unread counts for both sides. Users can start up to 10 conversations an hour.
- The sidebar badge refreshes every minute while the tab is visible, and when returning to the tab.
- `APP_TIMEZONE` (default `Africa/Kampala`) sets the time shown in reminder titles ("goes out tomorrow at 09:00").

## Tests

`npm run inbox:selftest` covers:
- reply understanding (including "now" not being read as "no", and button labels winning)
- the AI fallback being limited to the item's own buttons
- audience targeting (AND between filters, OR within, chosen users always included, literal sector matching)
- the assistant tools

`npm run selftest` runs every self-test in the backend.
