# FireScope — Frontend

React + TypeScript + Vite web app for the FireScope wildfire risk platform. Renders interactive maps with `@vis.gl/react-google-maps` and `deck.gl` v9, plus a Radix UI + Tailwind component library.

## Requirements

- Node.js 18+
- A Google Maps JavaScript API key
- A running FireScope backend (see `../backend/README.md`)

## Setup

```bash
npm install
cp .env.example .env       # fill in VITE_GOOGLE_MAPS_API_KEY and VITE_API_URL
npm run dev                # http://localhost:3000
```

`VITE_API_URL` should point at the backend, e.g. `http://localhost:5000/api` for local dev or the Render URL in production.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build into `build/` (consumed by Netlify and the Docker image) |

## Deployment

Netlify auto-deploys from the `domain-deployment` branch — `main` is mirrored to it by CI on every push (see `.github/workflows/`). Build settings live in `netlify.toml` at the repo root.

## Layout

```
src/
├── App.tsx                # Router + global providers
├── components/            # Page components and UI primitives (Radix wrappers)
├── layers/                # deck.gl layer factories (perimeters, risk zones, shelters, ...)
├── services/              # Backend API client modules
├── context/               # React contexts (auth, settings, alerts)
├── config/                # Runtime config + env access
├── Data/                  # Bundled CSV / JSON (county shapes, mock risk data)
├── utils/                 # Helpers (haversine, color scales, formatting)
├── styles/ + index.css    # Tailwind + global styles
└── Attributions.md        # Data-source attributions surfaced on the About page

public/
└── Data/                  # Static GeoJSON served as-is (trimmed FRAP perimeters, DINS damage points)
```
