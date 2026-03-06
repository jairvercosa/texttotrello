import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import OpenAI from 'openai';
import axios from 'axios';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TRELLO_BASE = 'https://api.trello.com/1';
const trelloAuth = () => ({
  key: process.env.TRELLO_API_KEY,
  token: process.env.TRELLO_TOKEN,
});

// ─── AI extraction ───────────────────────────────────────────────────────────

const SYSTEM_TRANSCRIPT = `You are an expert meeting analyst. Extract ALL clear action items and next steps from meeting transcripts.

For each action item return a JSON object with:
- title: short imperative title (max 10 words)
- what: what needs to be done (1-3 sentences)
- intention: why it matters / what it accomplishes (1-3 sentences)
- requirements: specific requirements or constraints mentioned (bullet points as array of strings, empty array if none)
- assignee: name of person responsible (null if unclear)
- confidence: "high" | "medium" | "low"

Only extract genuine commitments and action items — not ideas, rejected suggestions, or general discussion.
Respond ONLY with a valid JSON array. No markdown, no explanation.`;

const SYSTEM_DOCUMENT = `You are an expert project analyst. Break down the provided document into discrete, actionable work items / tasks.

For each task return a JSON object with:
- title: short imperative title (max 10 words)
- what: what needs to be done (1-3 sentences)
- intention: why it matters / what it accomplishes (1-3 sentences)
- requirements: specific requirements or constraints mentioned (bullet points as array of strings, empty array if none)
- assignee: null

Group related work sensibly. Avoid duplicates. Be comprehensive.
Respond ONLY with a valid JSON array. No markdown, no explanation.`;

async function extractCards(text, mode) {
  const system = mode === 'transcript' ? SYSTEM_TRANSCRIPT : SYSTEM_DOCUMENT;

  
  const response = await openai.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ],
  });

  const raw = response.choices[0].message.content.trim();
  return JSON.parse(raw);
}

// ─── Trello helpers ───────────────────────────────────────────────────────────

async function getTrelloBoards() {
  const { data } = await axios.get(`${TRELLO_BASE}/members/me/boards`, {
    params: { ...trelloAuth(), filter: 'open', fields: 'id,name' },
  });
  return data;
}

async function getTrelloLists(boardId) {
  const { data } = await axios.get(`${TRELLO_BASE}/boards/${boardId}/lists`, {
    params: { ...trelloAuth(), filter: 'open', fields: 'id,name' },
  });
  return data;
}

async function getTrelloMembers(boardId) {
  const { data } = await axios.get(`${TRELLO_BASE}/boards/${boardId}/members`, {
    params: { ...trelloAuth(), fields: 'id,fullName,username' },
  });
  return data;
}

function buildDescription(card) {
  return [
    `## What\n${card.what}`,
    `## Intention\n${card.intention}`,
    `## Requirements\n${
      card.requirements && card.requirements.length
        ? card.requirements.map((r) => `- ${r}`).join('\n')
        : '_None specified_'
    }`,
  ].join('\n\n');
}

async function createTrelloCard({ title, description, listId, memberId }) {
  const { data } = await axios.post(`${TRELLO_BASE}/cards`, null, {
    params: {
      ...trelloAuth(),
      idList: listId,
      name: title,
      desc: description,
      ...(memberId ? { idMembers: memberId } : {}),
    },
  });
  return data;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post('/api/extract', async (req, res) => {
  try {
    const { text, mode } = req.body;
    if (!text || !mode) return res.status(400).json({ error: 'text and mode required' });
    const cards = await extractCards(text, mode);
    res.json({ cards });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trello/boards', async (req, res) => {
  try {
    const boards = await getTrelloBoards();
    res.json(boards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trello/boards/:boardId/lists', async (req, res) => {
  try {
    const lists = await getTrelloLists(req.params.boardId);
    res.json(lists);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trello/boards/:boardId/members', async (req, res) => {
  try {
    const members = await getTrelloMembers(req.params.boardId);
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trello/cards', async (req, res) => {
  try {
    const { cards, listId, members } = req.body;
    // members = { "Name": "trelloMemberId", ... }
    const results = [];
    for (const card of cards) {
      const memberId = card.assignee && members ? members[card.assignee] : null;
      const created = await createTrelloCard({
        title: card.title,
        description: buildDescription(card),
        listId,
        memberId,
      });
      results.push({ title: card.title, url: created.shortUrl, id: created.id });
    }
    res.json({ created: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Exports for testing ─────────────────────────────────────────────────────

export { app, buildDescription, extractCards };

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`TextToTrello running at http://localhost:${PORT}`));
}
