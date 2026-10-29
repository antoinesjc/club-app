# Mandarin Zest Club app

Installable web app (PWA) for paying Club members: https://app.mandarinzest.com

Plain HTML/CSS/JS, no build step. Hosted on GitHub Pages (custom domain in `CNAME`).
Backend: Supabase project `mandarin-zest-club` (ref `eypehvhcqzhwssydvrhn`, EU).

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app: login, Home, My sessions, Members, Me |
| `fruits.js` | Fruit avatars (SVG), Chinese names (simplified/traditional), **levels and unlocks** (`LEVELS`, `level` per fruit) |
| `hosts-art.js` | Eight host-only illustrated avatars (Confucius, Empress, Poet, General, Calligrapher, Opera star, Qipao lady, Tang lady) |
| `countries.js`, `flags/` | Country list and flags ([flag-icons](https://github.com/lipis/flag-icons), MIT) |
| `vendor/supabase.js` | Bundled `@supabase/supabase-js` 2.118 (no CDN needed) |
| `vendor/pdf.js` | Bundled jsPDF 4.2.1 + html2canvas 1.4.1, loaded only for "Download PDF" |
| `manifest.webmanifest`, `sw.js`, `icons/` | Install as an app, offline shell |
| `supabase/migrations/` | Database: tables, access rules, schedules |
| `supabase/functions/send-code` | Login: sends the 6-digit code only to Club members (live Stripe check for new payers) |
| `supabase/functions/sync` | Background jobs: Google Calendar → sessions (every 15 min), Stripe → members (daily 02:07 UTC), sheet sync, notifications (every 5 min) |
| `supabase/functions/push-test` | "Send me a test" notification button |
| `supabase/functions/_shared/notify.ts` | Web Push + email fallback (Resend, needs the `RESEND_API_KEY` secret) |
| `apps-script/club-members.gs` | Apps Script for the "Club members" Google Sheet |

## Who can log in

`public.access_role(email)`:
1. "Members" tab of the Club members sheet says **blocked** → no access.
2. "Members" tab says **active** → access with that role (member / host / admin).
3. Stripe: monthly subscription active (+3 days grace), or yearly payment less than 12 months old
   (renewals stack; full refunds don't count) → member.

Payment links (US$25/month, US$250/year since 21 Oct 2026): monthly `plink_1USwvpFSITwJ0tdSclfdQxwj`, yearly `plink_1USwunFSITwJ0tdSjeNvHqIS`. Old links still count: monthly `plink_1UR8dsFSITwJ0tdScr66iqQh`, yearly `plink_1UR8h6FSITwJ0tdSyzBTSsLY` (lists in `supabase/functions/_shared/stripe.ts`)
(in `supabase/functions/_shared/stripe.ts`).

## Secrets (Supabase → Edge Functions → Secrets, set by Antoine)

`STRIPE_KEY` (restricted, read-only), `GCAL_ICS_URL` (secret iCal address of the Club calendar), `RESEND_API_KEY` (email fallback; without it only app notifications are sent).
The notification keys (VAPID) live in `private.config`; the public one is also in `app.js`.
The sheet sync secret lives in `private.config` in the database and in the Apps Script's Script properties.

## Calendar rules

Same as the website calendar: the title gives the level (`HSK 2-4`) and category; the description's
`Topic:`, `About:` and `Host:` lines are shown. `#hide` / `#private` in the title hides a session.
`#trial` is ignored (trial sessions are normal Club sessions). Members also get the Meet link.

## Phases

1. ✅ Login, sessions + "I'm in", profiles + fruit avatars, member directory
2. ✅ Notifications (reminder 1 h before sessions you're in, new sessions, notes are up; email fallback), host attendance + notes, members can download notes as a PDF ("My sessions" replaces Notion)
3. ✅ XP (+20 per ticked session, +50 every 4 weeks in a row, +150 bootcamp or any bonus given by an admin on the member page), 18 levels and fruit unlocks, leaderboard (month / all time; hosts excluded). Levels and fruit levels live in `fruits.js` **and** in the database functions `xp_level` / `fruit_level`: change both.

## Later additions (19 Oct)

- Discord chat link: left sidebar on the web, top of Members on phones.
- Host-only illustrated avatars (`hosts-art.js`; database checks `host-*` keys are used by hosts only).
- Short bio (140 characters) on Me.
- Chinese level options: Beginner, Lower intermediate, Intermediate, Upper intermediate, Advanced.
- Member cards: tap anyone in Members to see avatar, bio, level and XP, sessions attended, Chinese level, country and Discord; admins also give XP there.
- Desktop: List / Calendar switch on Home (month grid, colours by session type, ✓ for sessions you joined; choice remembered). Phones keep the list.
- Bootcamps: read from the website feed (`bootcamps.json` in Mandarin-Zest-Class-Calendar, rebuilt daily), sorted by date, with the Club price; "Ask a host to join" opens the Club Discord. Desktop: sidebar item. Phone: "Explore our bootcamps" square on Home (no prices there).

## Stickers (20 Oct 2026)
- Catalogue in `stickers.js` (bubble tea, four tones, lantern, dumpling, brush, mooncake). Keys must match `public.sticker_ok()` in the database.
- Admins give stickers on a member's card ("Give XP or a sticker"): pick the bootcamp, set the XP (0 = sticker only), pick the sticker (suggested from the bootcamp title). Table `sticker_awards`; taking one back also removes it from the avatar.
- Members wear one sticker (`profiles.sticker`) at the bottom-left of their avatar; the Stickers section in Me only appears once they have one. Hosts and admins see and can wear all of them.
- To add a sticker: add it to `stickers.js` and to `sticker_ok()`.
- Bootcamp rewards (table `bootcamp_rewards`, keyed by the bootcamp's page URL): admins tap "Edit" on a bootcamp card to set the XP and sticker; members see "Finish it and earn …" on the card, and the Give XP form fills in from it.

## Session levels and categories (30 Oct 2026)
- Same structure as the website calendar: hosts write `Level:`, `Category:` and `Host:` lines in the Google Calendar description.
- Edge function `session-meta` (every 15 min, pg_cron via `private.call_fn`) reads them with the website's rules and writes `sessions.skill_level` and `sessions.cats`. The old `sessions.category` column is no longer used by the app.
- Labels and colours in `app.js` (`SESSION_LEVELS`, `CATEGORIES`) mirror `categories.js` on the website: change both.
- Home filters: one level (sessions for "All levels" always match) + any number of categories, remembered per device.
- Desktop "My notes" page (`#/notes`): every attended session, most recent first, with notes and a search box (hosts: every session with notes).
