# FA Architectural Design — website and client portal

One app that serves:

- **The website** at `/` (English, French, Arabic; day and night mode)
- **The client portal** at `/portal/` — clients follow progress, approve decisions, read documents, see site photos and payments, and message the studio
- **The studio panel** at `/portal/studio/` — the studio manages clients, projects, uploads, approvals, payments, messages and website requests

## How it is built

| Part | What it uses |
|---|---|
| Server | Node.js 22 (built-in modules only) |
| Database | PostgreSQL (the `pg` package is the only dependency) |
| Files | Saved on a Railway volume mounted at `/data` |
| Notifications | Standard web push; keys are created automatically on first start |
| Hosting | Railway, deployed automatically from GitHub |

Folders:

```
server/        the app server (routes, logins, uploads, notifications)
db/schema.sql  database tables (applied automatically on every start)
public/        the website, the portal pages and images
```

## Settings

See `.env.example`. On Railway they are set as service variables.
The first studio account is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` the first time the app starts.
After you sign in and change your password, delete `ADMIN_PASSWORD` from Railway.

**Automatic emails.** Add `BREVO_API_KEY` and `EMAIL_FROM` (a sender verified in Brevo) and the portal
emails clients by itself: "Forgot password" sends a new one-time link straight to the client, and new
clients receive their invitation by email. Without these settings, the studio is notified instead and
sends the link on WhatsApp.

## Updating

Change files, then:

```
git add .
git commit -m "Describe the change"
git push
```

Railway redeploys automatically after each push.
