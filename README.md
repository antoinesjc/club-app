# Mandarin Zest Club app

Installable web app (PWA) for paying Club members: https://app.mandarinzest.com

Plain HTML/CSS/JS, no build step. Hosted on GitHub Pages (custom domain in `CNAME`).
Backend: Supabase project `mandarin-zest-club` (ref `eypehvhcqzhwssydvrhn`, EU).

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app: login, Home, My sessions, Members, Me |
| `fruits.js` | Fruit avatars (SVG), Chinese names (simplified/traditional), **levels and unlocks** (`LEVELS`, `level` per fruit) |
| `countries.js`, `flags/` | Country list and flags ([flag-icons](https://github.com/lipis/flag-icons), MIT) |
| `vendor/supabase.js` | Bundled `@supabase/supabase-js` 2.118 (no CDN needed) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Install as an app, offline shell |
| `supabase/migrations/` | Database: tables, access rules, schedules |
| `supabase/functions/send-code` | Login: sends the 6-digit code only to Club members (live Stripe check for new payers) |
| `supabase/functions/sync` | Background jobs: Google Calendar → sessions (every 15 min), Stripe → members (daily 02:07 UTC), sheet sync |
| `apps-script/club-members.gs` | Apps Script for the "Club members" Google Sheet |

## Who can log in

`public.access_role(email)`:
1. "Members" tab of the Club members sheet says **blocked** → no access.
2. "Members" tab says **active** → access with that role (member / host / admin).
3. Stripe: monthly subscription active (+3 days grace), or yearly payment less than 12 months old
   (renewals stack; full refunds don't count) → member.

Payment links: monthly `plink_1UR8dsFSITwJ0tdScr66iqQh`, yearly `plink_1UR8h6FSITwJ0tdSyzBTSsLY`
(in `supabase/functions/_shared/stripe.ts`).

## Secrets (Supabase → Edge Functions → Secrets, set by Antoine)

`STRIPE_KEY` (restricted, read-only), `GCAL_ICS_URL` (secret iCal address of the Club calendar).
The sheet sync secret lives in `private.config` in the database and in the Apps Script's Script properties.

## Calendar rules

Same as the website calendar: the title gives the level (`HSK 2-4`) and category; the description's
`Topic:`, `About:` and `Host:` lines are shown. `#hide` / `#private` in the title hides a session.
`#trial` is ignored (trial sessions are normal Club sessions). Members also get the Meet link.

## Phases

1. ✅ Login, sessions + "I'm in", profiles + fruit avatars, member directory
2. Notifications, host attendance + notes ("My sessions" replaces Notion)
3. XP, levels, fruit unlocks, leaderboard
