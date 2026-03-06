import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock OpenAI before importing server
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: class {
      constructor() {
        this.chat = { completions: { create: mockCreate } };
      }
    },
    __mockCreate: mockCreate,
  };
});

// Mock axios before importing server
vi.mock('axios', () => {
  const mockGet = vi.fn();
  const mockPost = vi.fn();
  return { default: { get: mockGet, post: mockPost } };
});

// Set env vars before importing server
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = 'test-key';
process.env.TRELLO_API_KEY = 'test-trello-key';
process.env.TRELLO_TOKEN = 'test-trello-token';

const { app, buildDescription } = await import('./server.js');
const axios = (await import('axios')).default;
const { __mockCreate: mockCreate } = await import('openai');

// ─── buildDescription ────────────────────────────────────────────────────────

describe('buildDescription', () => {
  it('formats card with requirements', () => {
    const result = buildDescription({
      what: 'Build the login page',
      intention: 'Allow users to authenticate',
      requirements: ['Use OAuth', 'Support SSO'],
    });

    expect(result).toContain('## What\nBuild the login page');
    expect(result).toContain('## Intention\nAllow users to authenticate');
    expect(result).toContain('- Use OAuth');
    expect(result).toContain('- Support SSO');
  });

  it('shows placeholder when requirements are empty', () => {
    const result = buildDescription({
      what: 'Do something',
      intention: 'For reasons',
      requirements: [],
    });

    expect(result).toContain('_None specified_');
  });

  it('shows placeholder when requirements are undefined', () => {
    const result = buildDescription({
      what: 'Do something',
      intention: 'For reasons',
    });

    expect(result).toContain('_None specified_');
  });
});

// ─── POST /api/extract ───────────────────────────────────────────────────────

describe('POST /api/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when text is missing', async () => {
    const res = await request(app).post('/api/extract').send({ mode: 'transcript' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('text and mode required');
  });

  it('returns 400 when mode is missing', async () => {
    const res = await request(app).post('/api/extract').send({ text: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('text and mode required');
  });

  it('extracts cards from transcript', async () => {
    const mockCards = [
      { title: 'Fix bug', what: 'Fix the login bug', intention: 'Users can log in', requirements: [], assignee: 'Alice', confidence: 'high' },
    ];
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(mockCards) } }],
    });

    const res = await request(app).post('/api/extract').send({ text: 'Meeting notes...', mode: 'transcript' });
    expect(res.status).toBe(200);
    expect(res.body.cards).toEqual(mockCards);
  });

  it('returns 500 when OpenAI fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API error'));

    const res = await request(app).post('/api/extract').send({ text: 'hello', mode: 'document' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('API error');
  });
});

// ─── Trello routes ───────────────────────────────────────────────────────────

describe('GET /api/trello/boards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns boards from Trello', async () => {
    const boards = [{ id: '1', name: 'Board 1' }];
    axios.get.mockResolvedValueOnce({ data: boards });

    const res = await request(app).get('/api/trello/boards');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(boards);
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.trello.com/1/members/me/boards',
      expect.objectContaining({ params: expect.objectContaining({ key: 'test-trello-key', token: 'test-trello-token' }) }),
    );
  });

  it('returns 500 when Trello fails', async () => {
    axios.get.mockRejectedValueOnce(new Error('Trello down'));

    const res = await request(app).get('/api/trello/boards');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Trello down');
  });
});

describe('GET /api/trello/boards/:boardId/lists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns lists for a board', async () => {
    const lists = [{ id: 'l1', name: 'Backlog' }];
    axios.get.mockResolvedValueOnce({ data: lists });

    const res = await request(app).get('/api/trello/boards/abc123/lists');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(lists);
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.trello.com/1/boards/abc123/lists',
      expect.anything(),
    );
  });
});

describe('GET /api/trello/boards/:boardId/members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns members for a board', async () => {
    const members = [{ id: 'm1', fullName: 'Alice', username: 'alice' }];
    axios.get.mockResolvedValueOnce({ data: members });

    const res = await request(app).get('/api/trello/boards/abc123/members');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(members);
  });
});

describe('POST /api/trello/cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates cards on Trello', async () => {
    axios.post.mockResolvedValueOnce({
      data: { id: 'card1', shortUrl: 'https://trello.com/c/abc' },
    });

    const res = await request(app).post('/api/trello/cards').send({
      listId: 'list1',
      cards: [{ title: 'Task 1', what: 'Do it', intention: 'Because', requirements: ['R1'], assignee: 'Alice' }],
      members: { Alice: 'member1' },
    });

    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0]).toEqual({
      title: 'Task 1',
      url: 'https://trello.com/c/abc',
      id: 'card1',
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.trello.com/1/cards',
      null,
      expect.objectContaining({
        params: expect.objectContaining({
          idList: 'list1',
          name: 'Task 1',
          idMembers: 'member1',
        }),
      }),
    );
  });

  it('creates card without member when assignee has no match', async () => {
    axios.post.mockResolvedValueOnce({
      data: { id: 'card2', shortUrl: 'https://trello.com/c/def' },
    });

    const res = await request(app).post('/api/trello/cards').send({
      listId: 'list1',
      cards: [{ title: 'Task 2', what: 'Do it', intention: 'Because', requirements: [], assignee: null }],
      members: {},
    });

    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);
  });

  it('returns 500 when card creation fails', async () => {
    axios.post.mockRejectedValueOnce(new Error('Card creation failed'));

    const res = await request(app).post('/api/trello/cards').send({
      listId: 'list1',
      cards: [{ title: 'Task', what: 'x', intention: 'y', requirements: [] }],
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Card creation failed');
  });
});
