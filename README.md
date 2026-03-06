# TextToTrello

Convert meeting transcripts and documents into Trello cards using AI.

## Features

- **Transcript Mode** — Paste a meeting transcript; AI extracts action items, detects owners, and structures each card with What / Intention / Requirements.
- **Document Mode** — Paste any spec, brief, or planning doc; AI decomposes it into discrete, actionable work items.
- **Review Step** — Inspect, edit, discard, and assign cards before pushing anything to Trello.
- **Smart Assignment** — Automatically maps detected names to Trello board members.
- **Backlog Auto-Select** — Automatically selects the Backlog list when loading a board.

## Setup

### 1. Clone & install

```bash
cd ~/src/242labs/texttotrello
npm install
```

### 2. Configure credentials

Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:

```env
OPENAI_API_KEY=sk-...
TRELLO_API_KEY=...
TRELLO_TOKEN=...
PORT=3000
```

#### Getting Trello credentials

1. **API Key**: Visit https://trello.com/power-ups/admin → select or create a Power-Up → copy the API Key.
2. **Token**: Go to `https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key=YOUR_API_KEY` → approve → copy the token.

### 3. Run

```bash
npm start
# or for development with auto-reload:
npm run dev
```

Open http://localhost:3000

## AI Models

The app uses OpenAI models. Edit `server.js` to switch:

| Task | Default | Alternatives |
|------|---------|--------------|
| Extraction | `gpt-5` | `gpt-5-mini`, `gpt-5-nano` |

Update the `model` field in the `extractCards()` function in `server.js`.

## Card Structure

Each Trello card description is formatted as:

```
## What
What needs to be done.

## Intention
Why this matters and what it accomplishes.

## Requirements
- Requirement 1
- Requirement 2
```

## Project Structure

```
texttotrello/
├── server.js          # Express API + OpenAI + Trello integration
├── public/
│   └── index.html     # Full frontend (single file)
├── .env.example       # Environment variable template
├── package.json
└── README.md
```
