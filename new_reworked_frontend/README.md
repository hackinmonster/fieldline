# Fieldline: volunteer app (reworked frontend)

Map-first phone UI for the Helene coordination backend. Design direction, tokens and rules: [`DESIGN.md`](DESIGN.md).

```bash
npm install
npm run dev            # http://localhost:5174
```

- **Live mode:** if the FastAPI backend answers on `:8000` (same `/api` + `/ws` proxy as `../frontend`), the app uses it:
  `POST /volunteers` on sign-up, accept / decline / complete, availability, field reports, WebSocket updates.
- **Finishing a task** is one tap: "Yes, I did it". No photos or codes. The backend's `POST /assignments/:id/complete`
  checks the volunteer's last GPS fix is within 200 m of the task and returns 409 otherwise; the button stays locked until then.
- **Demo mode:** if the backend is unreachable, the app says so and runs on `src/data/fixture.json`.
  Jordan's offer arrives about 9 s after onboarding; on the active task, "Demo: drive the route" moves you along it.
  Force it with `?demo`.

## Pages

| Path | What |
|---|---|
| `/welcome` → `/onboard/identity` → `/onboard/skills` → `/onboard/permissions` | Onboarding |
| `/map` | Main disaster map (default home). Shows one task: your offer or active task, else the best match. Swipe the sheet up for the Tasks tab |
| `/feed`, `/tasks`, `/profile` | Tab screens |
| `/lock` | Lock-screen notification concept |
| `/task/:id` | Task invitation / review |
| `/active`, `/done` | Navigate and finish ("Yes, I did it"), receipt |
| `/flow` | User-flow overview: every step rendered live at phone size |
| `/kit` | Component sheet with all variants |

Demo scenes jump to one point in the story: `?scene=browse|offer|active|arrived|done` (e.g. `/active?scene=active`). Add `&embed` to drop the desktop device frame.

## Fixture

`python3 scripts/build_fixture.py` rebuilds it. NCDOT closures and USGS gauge readings come from `../backend/data`
at Sep 29 2024 10:12 AM EDT. Routes are fetched from the public OSRM server. Tasks, posts, volunteers and resource points are scripted to match `../replay/scenario.yaml`.

## Known gaps

- There's no SMS service, so any 6-digit code is accepted.
- The backend has no endpoint for editing capabilities. Edits on the profile page are saved on the device only.
- In live mode, shelters/resources and the flood corridor come from the fixture, because the backend doesn't serve them.
