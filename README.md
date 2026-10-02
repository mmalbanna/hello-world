# BIM Resource Planner

Day-to-day allocation of BIM modelers to project tasks (P820 Qatar Central Bank, P860 Qatar Airways HQ, P875 HMC, P880 NKIA and the projects still to come), shared live with the team leads and the whole team.

One codebase runs everywhere:

| Platform | How it runs |
|---|---|
| iPad / iPhone | Safari → Share → **Add to Home Screen** (installable web app, works offline) |
| Android | Chrome → ⋮ → **Install app** |
| Windows / Mac | Edge or Chrome → install icon in the address bar → **Install** (opens in its own window) |
| App Store / Play Store (optional) | Same build wrapped with Capacitor, see `docs/NATIVE.md` |

All devices stay in sync through Firebase Firestore. Changes made by one person appear on every other device within seconds. Each device keeps an offline copy and syncs again when back online.

Author: Motasem Albanna

## What it does

- **Planner grid**: people in rows, days in columns, one task per person per working day. Drag a chip to another day or another person (touch and mouse). Tap an empty cell to assign a task for one day or a date range. Tap a chip to change the task, move it to someone else, extend it, add a note or remove it.
- **Task palette**: drag a task straight onto a cell, or tap a task and then tap cells to assign it.
- **Projects / Tasks / People** pages: projects with a colour each, tasks under each project, people with discipline, title, team lead and type (team member, subcontractor, supply chain).
- **Roles**: admin (you), team lead (Raja, Gloria, Suresh … can allocate and manage tasks), viewer (everyone else, read only).
- **Live activity log** with toast notifications when someone else changes the plan.
- **Share the plan**: Excel (.xlsx), Word (.docx) and PDF with the allocation grid per week, people per project per day and allocation by project. On iPad and Android the buttons open the share sheet (WhatsApp, Teams, Mail). There is also a plain-text summary for chat.
- Working week Sunday to Thursday by default, with public holidays, configurable in Settings.

## One-time setup (about 15 minutes)

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com>, **Add project** (for example `bim-planner`). Google Analytics is not needed.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
3. **Build → Firestore Database → Create database → Start in production mode**, pick a region close to Qatar (for example `europe-west3` or `asia-south1`).
4. **Project settings (gear) → Your apps → Web (`</>`) → register the app** (name `BIM Planner`). Copy the `firebaseConfig` values shown.

### 2. Put the config into the app

Edit `public/firebase-config.json` and replace the `REPLACE_ME` values with the ones from step 4. These values are not secrets; access is controlled by the security rules below.

### 3. Publish the security rules

Either paste the contents of `firestore.rules` into **Firestore Database → Rules → Publish**, or from a terminal:

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # pick your project
firebase deploy --only firestore
```

### 4. Deploy the app (GitHub Pages, free)

1. In the GitHub repository: **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Push to `master`. The workflow in `.github/workflows/deploy.yml` builds and publishes the app at `https://<your-user>.github.io/<repo>/`.
3. Add that URL to **Firebase → Authentication → Settings → Authorized domains** (add `<your-user>.github.io`).

Any other static host works too (Firebase Hosting: `npm run build && firebase deploy --only hosting`).

### 5. Make yourself admin (once)

1. Open the app URL, **Create account** with your email and password.
2. In Firebase console → **Firestore Database → Data → `users` → your document → change `role` from `viewer` to `admin`.**
3. Reload the app. The **Access** page now appears in the menu.

### 6. Set up the team

1. **Settings → Load sample data** gives you the four projects, three team leads and example modelers to start from, or add them yourself in **Projects** and **People**.
2. Ask the team to open the same URL and **Create account**. They start as viewers.
3. In **Access**, set Raja, Gloria, Suresh and the other leads to **Team lead**.
4. In **People**, enter each person's email so their own row is highlighted when they sign in.

## Day-to-day use

- Open the **Planner**. Use the arrows or **Today** to move through weeks; choose 1 to 6 weeks of view.
- **Assign**: tap an empty cell → pick project and task → set "Until" for a block of days → Assign. Tick other people to assign them to the same task and dates.
- **Move**: drag a chip to a different day or person. Dropping onto an occupied cell swaps the two. Hold **Alt** (desktop) or switch the toolbar to **Drag copies** to copy instead.
- **Change**: tap a chip → Change task / Move to another person / Extend / Remove, each for this day only or for the following days of the block.
- **Filters**: project, discipline, team lead, type, search; group by discipline or by team lead.
- **Share plan**: pick the range, filter if needed, then Excel, Word, PDF or plain text.

## Exports

Excel and Word documents are authored as **Motasem Albanna** in the **Aptos** font. PDF embeds Aptos only if `public/fonts/Aptos.ttf` and `Aptos-Bold.ttf` are present (copy them from a Windows PC with Microsoft 365, see `public/fonts/README.txt`); otherwise the PDF uses Helvetica and the app tells you so.

## Development

```bash
npm install
npm run dev              # http://localhost:5173
npm run build            # production build in dist/
npm run emulators        # local Firebase Auth + Firestore emulators (needs Java 11+)
```

To develop against the emulators, copy `.env.example` to `.env.local` and set `VITE_FIREBASE_EMULATOR=1` plus any values for the `VITE_FIREBASE_*` keys (they only need to be non-empty).

## Project structure

```
public/firebase-config.json   Firebase web config (edit this)
firestore.rules               Security rules (publish these)
src/pages/                    Planner, Projects, Tasks, People, Reports, Access, Settings, Activity
src/components/planner/       Grid cell, chip, drag-and-drop, assign and detail dialogs, task palette
src/lib/repo.ts               All writes to Firestore (batched, with activity log)
src/store/useStore.ts         Live subscriptions and session state
src/export/                   Excel, Word, PDF and plain-text exports
.github/workflows/deploy.yml  GitHub Pages deployment
capacitor.config.ts           Native iOS / Android shell (optional)
```

## Data model

| Collection | One document per | Key fields |
|---|---|---|
| `projects` | project | code, name, client, colour, status |
| `tasks` | task | projectId, name, discipline, start/end, status, priority |
| `people` | team member / subcontractor | name, title, discipline, type, leadId, email, active |
| `allocations` | person **and** day (`<personId>__<YYYY-MM-DD>`) | taskId, projectId, note, updatedBy |
| `users` | sign-in account | displayName, email, role |
| `settings/general` | workspace | working days, holidays, disciplines, titles |
| `activity` | change | who, when, what |

One document per person per day means two people can never be double-booked into the same cell, and a move is a delete plus a write in one atomic batch.
