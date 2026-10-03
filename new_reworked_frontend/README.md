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
- **Declining** moves the task to a "You declined" section at the bottom of the Tasks tab. It stays open to you:
  "Accept and navigate" calls the new `POST /tasks/:id/claim` (`{volunteer_id}`), which works as long as nobody has
  accepted it yet (a pending offer to someone else is withdrawn) and you have no other active task.
- **Demo mode:** if the backend is unreachable, the app says so and runs on `src/data/fixture.json`.
  Jordan's offer arrives about 9 s after onboarding; on the active task, "Demo: drive the route" moves you along it.
  Force it with `?demo`.

## Pages

| Path | What |
|---|---|
| `/welcome` → `/onboard/identity` → `/onboard/skills` → `/onboard/permissions` | Onboarding |
| `/map` | Main disaster map (default home). Shows one task (your offer or active task, else the best match) in a content-sized island. Swipe it up for the Tasks tab |
| `/feed`, `/tasks`, `/profile` | Tab screens |
| `/lock` | Lock-screen notification concept |
| `/task/:id` | Task invitation / review |
| `/active`, `/done` | Navigate and finish ("Yes, I did it"), receipt |
| `/flow` | User-flow overview: every step rendered live at phone size |
| `/kit` | Component sheet with all variants |

Demo scenes jump to one point in the story: `?scene=browse|offer|active|arrived|done` (e.g. `/active?scene=active`). Add `&embed` to drop the desktop device frame.

## Fixture

`python3 scripts/build_fixture.py` rebuilds it from `../replay/scenario.yaml`, parked at the scenario's `live_start`,
so the offline demo shows what Command shows after *Load scenario*: the same 16 volunteers and the same 15 reports,
11 incidents and 10 tasks. NCDOT closures and USGS readings come from `../backend/data`, and routes come from the public OSRM server.
The wording of each incident and task is hand-written; with the backend running, the LLM pipeline writes it.

## With the Command dashboard

- Command (`../frontend`, `/command`) dispatches. The offer lands here.
- *Open <name>'s phone* opens `/map?as=<id>`. The footer's *Volunteer app* opens `/map?as=follow`, which becomes whoever was dispatched most recently.
- Source names, task types and status colors are the same in both apps. `../frontend/src/tokens.css` is a copy of `src/styles/tokens.css`.

## Known gaps

- There's no SMS service, so any 6-digit code is accepted.
- The backend has no endpoint for editing capabilities. Edits on the profile page are saved on the device only.
- Shelters and distribution points on the map are the places the scenario's reports name. The backend doesn't serve them, so they come from the fixture even in live mode.
