import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { authMiddleware, issueToken, verifyToken } from './auth.js';
import { createUser, findUserById, findUserByUsername } from './db.js';
import { applyGameAction, buildGameView, createGameState, GAME_TYPES } from './game/gameManager.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'] }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'] }
});

const rooms = new Map();
const socketsByUserId = new Map();

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function publicRoom(room) {
  return {
    code: room.code,
    players: room.players.map((p) => ({ userId: p.userId, username: p.username, connected: Boolean(socketsByUserId.get(p.userId)) })),
    gameType: room.gameType,
    canStart: room.players.length === 2,
    gameTypes: GAME_TYPES
  };
}

function emitRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  io.to(roomCode).emit('room:update', publicRoom(room));

  if (room.gameState) {
    for (const player of room.players) {
      const socketId = socketsByUserId.get(player.userId);
      if (!socketId) continue;
      io.to(socketId).emit('game:update', buildGameView(room.gameState, player.userId, room.players));
    }
  }
}

function getUserRoom(userId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.userId === userId)) return room;
  }
  return null;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Username or password too short' });
  }

  if (findUserByUsername(username)) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = createUser(username, passwordHash);
  const user = findUserById(result.lastInsertRowid);
  const token = issueToken(user);
  res.json({ token, user });
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  const user = findUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = issueToken(user);
  res.json({ token, user: { id: user.id, username: user.username } });
});

app.post('/api/rooms', authMiddleware, (req, res) => {
  if (getUserRoom(req.user.id)) {
    return res.status(400).json({ error: 'You are already in a room' });
  }

  let code;
  do {
    code = makeRoomCode();
  } while (rooms.has(code));

  rooms.set(code, {
    code,
    players: [{ userId: req.user.id, username: req.user.username }],
    gameType: null,
    gameState: null,
    createdAt: Date.now()
  });

  res.json({ code });
});

app.post('/api/rooms/join', authMiddleware, (req, res) => {
  const code = String(req.body.code || '').toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.players.length >= 2 && !room.players.some((p) => p.userId === req.user.id)) {
    return res.status(400).json({ error: 'Room is full' });
  }

  if (!room.players.some((p) => p.userId === req.user.id)) {
    room.players.push({ userId: req.user.id, username: req.user.username });
  }

  emitRoom(code);
  res.json({ code, room: publicRoom(room) });
});

app.get('/api/rooms/:code', authMiddleware, (req, res) => {
  const room = rooms.get(String(req.params.code).toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!room.players.some((p) => p.userId === req.user.id)) return res.status(403).json({ error: 'Not in room' });
  res.json(publicRoom(room));
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));
  try {
    socket.user = verifyToken(token);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  socketsByUserId.set(user.id, socket.id);

  const room = getUserRoom(user.id);
  if (room) {
    socket.join(room.code);
    emitRoom(room.code);
  }

  socket.on('room:subscribe', ({ code }) => {
    const roomData = rooms.get(String(code || '').toUpperCase());
    if (!roomData) return;
    if (!roomData.players.some((p) => p.userId === user.id)) return;
    socket.join(roomData.code);
    emitRoom(roomData.code);
  });

  socket.on('game:select', ({ code, gameType }) => {
    const roomData = rooms.get(String(code || '').toUpperCase());
    if (!roomData) return socket.emit('error:message', 'Room not found');
    if (!roomData.players.some((p) => p.userId === user.id)) return;
    if (!GAME_TYPES.includes(gameType)) return socket.emit('error:message', 'Unsupported game');
    if (roomData.players.length !== 2) return socket.emit('error:message', 'Need two players');

    roomData.gameType = gameType;
    roomData.gameState = createGameState(gameType, roomData.players.map((p) => p.userId));
    emitRoom(roomData.code);
  });

  socket.on('game:action', ({ code, action }) => {
    const roomData = rooms.get(String(code || '').toUpperCase());
    if (!roomData || !roomData.gameState) return;
    if (!roomData.players.some((p) => p.userId === user.id)) return;

    const result = applyGameAction(roomData.gameState, user.id, action || {});
    if (!result.ok) {
      socket.emit('error:message', result.error);
      return;
    }

    emitRoom(roomData.code);
  });

  socket.on('disconnect', () => {
    const activeSocket = socketsByUserId.get(user.id);
    if (activeSocket === socket.id) socketsByUserId.delete(user.id);

    const userRoom = getUserRoom(user.id);
    if (userRoom) {
      if (userRoom.gameState && !userRoom.gameState.winnerUserId) {
        userRoom.gameState.message = `${user.username} disconnected. Waiting for reconnect...`;
      }
      emitRoom(userRoom.code);
    }
  });
});

const port = Number(process.env.PORT || 4000);
httpServer.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
