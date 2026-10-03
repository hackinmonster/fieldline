# Fieldline: design direction

Volunteer app for the disaster-response coordination backend. The demo scenario is Hurricane Helene in Buncombe County, NC; nothing in the product is specific to it. Replaces `../frontend/src/pages/Volunteer.tsx` with a map-first phone UI.
`../frontend` (`/command` dashboard) is untouched.

## User, task, context

- **Who:** a resident volunteering in their own area after a disaster, with what they have: a pickup, a chainsaw, first-aid training, Spanish.
- **Task:** find a nearby need they can actually meet, get there around closed roads, and say it is done. Their location is the only check.
- **Context:** days after a hurricane, flood or wildfire (the demo: two days after Helene). Outdoors, glare, one hand, patchy cell service, low battery, tired.
  So: large type, high contrast, few choices per screen, status always visible, nothing that depends on hover or color alone.

## Aesthetic

Reference: **highway signage and USGS topographic quads**, plus the paper field tag a crew ties to a door.
Condensed sign-face lettering for numbers and labels, route-shield blue for navigation, work-zone orange for caution,
square-shouldered tags instead of soft bubbles. No gradients, no glow, no decorative backgrounds. The map is the backdrop.

## Type

| Role | Face | Why |
|---|---|---|
| Display / numbers / labels | **Barlow Condensed** 600–700 | Drawn from highway and transit signage. Condensed, so ETAs, distances and street names fit on a 390px screen and on map labels. |
| Body | **Atkinson Hyperlegible Next** 400/700 | Made by the Braille Institute for low-vision readers. Distinct I/l/1 and 0/O matter when reading a house number in the rain. |
| Codes | **JetBrains Mono** 500 | Only for verification codes, coordinates and radio transcripts. |

Scale (px): 12 · 14 · 16 (body) · 20 · 28 · 44 · 64. Body line height 1.5. Display line height 1.0–1.1.

## Color (role-named)

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#14212E` | Text, dominant brand color (tab bar, maneuver banner) |
| `--ink-2` | `#45525F` | Secondary text |
| `--ink-3` | `#5F6B78` | Tertiary text, AA on `--canvas` |
| `--canvas` | `#F3F5F7` | App background, cool gray tinted toward ink |
| `--surface` | `#FFFFFF` | Cards, sheets |
| `--line` | `#DCE1E6` | Dividers |
| `--route` | `#1D5FBF` | Navigation, information, the one primary action |
| `--caution` | `#E8740C` | Warnings, closures. Fill only; text uses `--caution-ink` `#9A4600` |
| `--danger` | `#C42B1C` | Urgent only: life/health risk within hours |
| `--done` | `#1E7A46` | Done / completed |
| `--water` | `#5B8FC9` | Flood overlay on the map, always at low opacity |

Every status chip pairs color with an icon and a word.

## Scales

- Spacing: 4 · 8 · 12 · 16 · 24 · 32 · 48
- Radius by size: 4 (chips, tags, markers) · 8 (buttons, inputs) · 12 (cards) · 20 (sheet top)
- Shadow: `--lift-1` floating map controls, `--lift-2` sheets and banners. Nothing else casts a shadow.

## Signature element per screen

| Screen | Signature |
|---|---|
| Welcome | The live snapshot line: open requests and closed roads right now |
| Skills | "You qualify for N of M open requests" recalculated as you tap |
| Map | One field-tag marker: your best match (or your current task). Swipe up for the full list |
| Feed | Source line: who said it (radio, NCDOT, USGS, resident, volunteer) and whether it's linked to a task |
| Invitation | Match ledger: why the system picked you, check by check |
| Active task | Maneuver sign (next turn in sign-face type); "Yes, I did it" unlocks within 200 m |
| Done | The receipt: what was done, where, when, how close |
| Profile | Capability tag: the same tag the matcher reads |

## Motion

Only to signal change: sheet snapping, the notification banner entering, route drawing on accept.
All of it is disabled under `prefers-reduced-motion`.

## Data

Live mode talks to the FastAPI backend (`/api/state`, WebSocket `/ws`, accept/decline/complete).
If the backend is unreachable the app says so and runs on `src/data/fixture.json`
(built by `scripts/build_fixture.py` from real NCDOT/USGS files and OSRM routes, with hand-written tasks and posts).
