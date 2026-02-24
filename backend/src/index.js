import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { authMiddleware, issueToken, verifyToken } from './auth.js';
import { applyGameAction, buildGameView, createGameState, GAME_TYPES, resolveDeferredGameState } from './game/gameManager.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'] }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'] }
});

const rooms = new Map();
const socketsByUserId = new Map();
const sessionsByUserId = new Map();
const usernameToUserId = new Map();
const releaseTimers = new Map();

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function makeUserId() {
  return Math.floor(Date.now() + Math.random() * 1000000);
}

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
    gameId: room.gameId || 0,
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
      io.to(socketId).emit('game:update', {
        gameId: room.gameId || 0,
        ...buildGameView(room.gameState, player.userId, room.players)
      });
    }
  }
}

function getUserRoom(userId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.userId === userId)) return room;
  }
  return null;
}

function ensureSessionFromTokenUser(tokenUser) {
  const normalized = normalizeUsername(tokenUser.username);
  const existingOwner = usernameToUserId.get(normalized);
  if (existingOwner && existingOwner !== tokenUser.id) return null;

  const session = sessionsByUserId.get(tokenUser.id) || {
    id: tokenUser.id,
    username: tokenUser.username,
    normalizedUsername: normalized,
    connections: 0
  };

  session.username = tokenUser.username;
  session.normalizedUsername = normalized;
  sessionsByUserId.set(session.id, session);
  usernameToUserId.set(normalized, session.id);

  return session;
}

function scheduleSessionRelease(userId) {
  if (releaseTimers.has(userId)) clearTimeout(releaseTimers.get(userId));
  const timer = setTimeout(() => {
    const session = sessionsByUserId.get(userId);
    if (!session || session.connections > 0) return;
    sessionsByUserId.delete(userId);
    if (usernameToUserId.get(session.normalizedUsername) === userId) {
      usernameToUserId.delete(session.normalizedUsername);
    }
    releaseTimers.delete(userId);
  }, 5 * 60 * 1000);
  releaseTimers.set(userId, timer);
}

function cancelSessionRelease(userId) {
  const timer = releaseTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    releaseTimers.delete(userId);
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/guest', (req, res) => {
  const username = String(req.body.username || '').trim();
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be 3-20 characters' });
  }

  const normalized = normalizeUsername(username);
  if (usernameToUserId.has(normalized)) {
    return res.status(409).json({ error: 'Username is currently in use' });
  }

  const user = { id: makeUserId(), username };
  const session = {
    id: user.id,
    username,
    normalizedUsername: normalized,
    connections: 0
  };

  sessionsByUserId.set(user.id, session);
  usernameToUserId.set(normalized, user.id);

  const token = issueToken(user);
  res.json({ token, user });
});

app.post('/api/rooms', authMiddleware, (req, res) => {
  if (!sessionsByUserId.has(req.user.id)) {
    return res.status(401).json({ error: 'Session expired. Rejoin with username.' });
  }

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
    gameId: 0,
    gameState: null,
    createdAt: Date.now()
  });

  res.json({ code });
});

app.post('/api/rooms/join', authMiddleware, (req, res) => {
  if (!sessionsByUserId.has(req.user.id)) {
    return res.status(401).json({ error: 'Session expired. Rejoin with username.' });
  }

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
    const tokenUser = verifyToken(token);
    const session = ensureSessionFromTokenUser(tokenUser);
    if (!session) return next(new Error('Username in use'));
    socket.user = { id: session.id, username: session.username };
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  const session = sessionsByUserId.get(user.id);
  if (session) {
    session.connections += 1;
    cancelSessionRelease(user.id);
  }

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

  socket.on('room:unsubscribe', ({ code }) => {
    const roomCode = String(code || '').toUpperCase();
    if (!roomCode) return;
    socket.leave(roomCode);
  });

  socket.on('game:select', ({ code, gameType }) => {
    const roomData = rooms.get(String(code || '').toUpperCase());
    if (!roomData) return socket.emit('error:message', 'Room not found');
    if (!roomData.players.some((p) => p.userId === user.id)) return;
    if (!GAME_TYPES.includes(gameType)) return socket.emit('error:message', 'Unsupported game');
    if (roomData.players.length !== 2) return socket.emit('error:message', 'Need two players');

    roomData.gameType = gameType;
    roomData.gameId = (roomData.gameId || 0) + 1;
    roomData.gameState = createGameState(gameType, roomData.players.map((p) => p.userId));
    io.to(roomData.code).emit('game:reinit', { code: roomData.code, gameId: roomData.gameId });
    emitRoom(roomData.code);
  });

  socket.on('game:snapshot', ({ code, gameId }) => {
    const roomData = rooms.get(String(code || '').toUpperCase());
    if (!roomData || !roomData.gameState) return;
    if (!roomData.players.some((p) => p.userId === user.id)) return;
    if (gameId != null && gameId !== roomData.gameId) return;
    socket.emit('game:update', {
      gameId: roomData.gameId || 0,
      ...buildGameView(roomData.gameState, user.id, roomData.players)
    });
  });

  socket.on('game:action', ({ code, gameId, action }) => {
    const roomData = rooms.get(String(code || '').toUpperCase());
    if (!roomData || !roomData.gameState) return;
    if (!roomData.players.some((p) => p.userId === user.id)) return;
    if (gameId != null && gameId !== roomData.gameId) {
      socket.emit('error:message', 'Stale game session. Resyncing...');
      socket.emit('game:reinit', { code: roomData.code, gameId: roomData.gameId });
      return;
    }

    const result = applyGameAction(roomData.gameState, user.id, action || {});
    if (!result.ok) {
      socket.emit('error:message', result.error);
      return;
    }

    emitRoom(roomData.code);

    if (result.deferred) {
      const lockedGameId = roomData.gameId;
      setTimeout(() => {
        const latestRoom = rooms.get(roomData.code);
        if (!latestRoom || !latestRoom.gameState) return;
        if (latestRoom.gameId !== lockedGameId) return;
        resolveDeferredGameState(latestRoom.gameState);
        emitRoom(latestRoom.code);
      }, result.delayMs || 3000);
    }
  });

  socket.on('disconnect', () => {
    const activeSocket = socketsByUserId.get(user.id);
    if (activeSocket === socket.id) socketsByUserId.delete(user.id);

    const liveSession = sessionsByUserId.get(user.id);
    if (liveSession) {
      liveSession.connections = Math.max(0, liveSession.connections - 1);
      if (liveSession.connections === 0) {
        scheduleSessionRelease(user.id);
      }
    }

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
