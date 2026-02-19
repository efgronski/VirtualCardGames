# Two-Player Real-Time Card Games

A minimal personal project for two remote players using:
- React (frontend)
- Node.js + Express (backend)
- Socket.io (real-time multiplayer)
- SQLite for user accounts
- In-memory room/game state for simplicity

## Folder Structure

```
.
├── backend
│   ├── .env.example
│   ├── package.json
│   └── src
│       ├── auth.js
│       ├── db.js
│       ├── index.js
│       └── game
│           ├── cards.js
│           ├── gameManager.js
│           └── engines
│               ├── ginRummy.js
│               ├── shithead.js
│               └── germanWhist.js
├── frontend
│   ├── .env.example
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   └── src
│       ├── api.js
│       ├── App.jsx
│       ├── main.jsx
│       ├── socket.js
│       └── styles/app.css
└── package.json
```

## Features

- Username
- Room create/join with short code
- Game selection (Gin Rummy, Shithead, German Whist)
- Server-authoritative card shuffling and move validation
- Turn enforcement and win detection
- Only each player's own hand is sent to that player
- Reconnect/disconnect status updates
- Mobile-responsive minimal UI with simple card animations

## Game Rules Coverage

The project implements clear, readable server engines for each game mode.
- `Gin Rummy`:
  - 10-card hands, aces low, no run wrapping
  - Knock allowed at deadwood `<= 10`
  - Gin bonus `20 + deadwood difference`
  - Undercut bonus `10 + deadwood difference`
  - 3-round match scoring
- `Shithead`:
  - Two-player 3-card starting hands
  - Draw back to 3 while draw pile exists
  - Specials: `2` reset, `3` mirror, `7` forces `7 or lower`, `10` bomb
  - Must pick up pile if no legal play
- `German Whist`:
  - Non-dealer leads first trick
  - First stage uses stock + exposed upcard draws
  - Second-stage-only trick counting for hand winner

## Run Locally

1. Install dependencies:

```bash
npm install
npm --prefix backend install
npm --prefix frontend install
```

2. Configure environment files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

3. Start backend and frontend in separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

4. Open frontend:

- [http://localhost:5173](http://localhost:5173)

Backend runs on:
- [http://localhost:4000](http://localhost:4000)

## Deploy (Free)

### Backend on Render

1. Push repo to GitHub.
2. In Render, create a **Web Service** from this repo.
3. Settings:
- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`
- Runtime: Node 20+
4. Environment variables:
- `PORT=4000`
- `CORS_ORIGIN=https://YOUR-VERCEL-DOMAIN.vercel.app`
- `JWT_SECRET=<long-random-secret>`
- `DB_FILE=./data.sqlite`
5. Deploy and copy Render URL.

Note: SQLite file is local to service instance. For this two-user personal project, that is often acceptable.

### Frontend on Vercel

1. Import the same repo into Vercel.
2. Configure project:
- Root directory: `frontend`
- Build command: `npm run build`
- Output directory: `dist`
3. Environment variable:
- `VITE_API_URL=https://YOUR-RENDER-SERVICE.onrender.com`
4. Deploy.

## Example Env Files

### `backend/.env`

```env
PORT=4000
CORS_ORIGIN=http://localhost:5173
JWT_SECRET=replace-this-with-a-long-random-string
DB_FILE=./data.sqlite
```

### `frontend/.env`

```env
VITE_API_URL=http://localhost:4000
```

## Notes

- This app is intentionally minimal and optimized for two users, not public scale.
- Room/game state is in-memory and resets on backend restart.
- If you want persistence later, add `rooms` and `games` tables and hydrate state on boot.
