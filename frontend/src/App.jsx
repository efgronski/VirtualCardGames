import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { connectSocket } from './socket';

const GAME_TYPES = [
  { value: 'gin-rummy', label: 'Gin Rummy' },
  { value: 'shithead', label: 'Shithead' },
  { value: 'german-whist', label: 'German Whist' }
];

function cardLabel(card) {
  return `${card.rank}${card.suit}`;
}

export default function App() {
  const [authMode, setAuthMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState(null);
  const [game, setGame] = useState(null);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!token) return;
    const s = connectSocket(token);

    s.on('room:update', (payload) => setRoom(payload));
    s.on('game:update', (payload) => {
      setGame(payload);
      setSelectedIds([]);
    });
    s.on('error:message', (msg) => setError(msg));

    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [token]);

  useEffect(() => {
    if (!socket || !roomCode) return;
    socket.emit('room:subscribe', { code: roomCode });
  }, [socket, roomCode]);

  const isMyTurn = game?.turnUserId === user?.id;

  async function handleAuth(e) {
    e.preventDefault();
    setError('');
    try {
      const data = await api(`/api/auth/${authMode}`, {
        method: 'POST',
        body: { username, password }
      });
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
    } catch (err) {
      setError(err.message);
    }
  }

  async function createRoom() {
    setError('');
    try {
      const data = await api('/api/rooms', { method: 'POST', token });
      setRoomCode(data.code);
      setRoomCodeInput(data.code);
      const roomData = await api(`/api/rooms/${data.code}`, { token });
      setRoom(roomData);
      socket?.emit('room:subscribe', { code: data.code });
    } catch (err) {
      setError(err.message);
    }
  }

  async function joinRoom() {
    setError('');
    const code = roomCodeInput.trim().toUpperCase();
    if (!code) return;
    try {
      await api('/api/rooms/join', { method: 'POST', token, body: { code } });
      setRoomCode(code);
      const roomData = await api(`/api/rooms/${code}`, { token });
      setRoom(roomData);
      socket?.emit('room:subscribe', { code });
    } catch (err) {
      setError(err.message);
    }
  }

  function selectGame(gameType) {
    if (!roomCode) return;
    socket?.emit('game:select', { code: roomCode, gameType });
  }

  function act(action) {
    if (!roomCode) return;
    socket?.emit('game:action', { code: roomCode, action });
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken('');
    setUser(null);
    setRoomCode('');
    setRoom(null);
    setGame(null);
    setSelectedIds([]);
  }

  const selectedRanks = useMemo(() => {
    const cards = game?.yourHand?.filter((c) => selectedIds.includes(c.id)) || [];
    return [...new Set(cards.map((c) => c.rank))];
  }, [game?.yourHand, selectedIds]);

  if (!token || !user) {
    return (
      <main className="page">
        <section className="panel auth-panel">
          <h1>Two-Player Card Games</h1>
          <p>Simple login for your private project.</p>
          <form onSubmit={handleAuth}>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="Password"
              required
            />
            <button type="submit">{authMode === 'login' ? 'Login' : 'Register'}</button>
          </form>
          <button className="link" onClick={() => setAuthMode((m) => (m === 'login' ? 'register' : 'login'))}>
            Switch to {authMode === 'login' ? 'register' : 'login'}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="panel">
        <div className="top-row">
          <h1>Welcome, {user.username}</h1>
          <button className="link" onClick={logout}>
            Logout
          </button>
        </div>

        {!roomCode ? (
          <>
            <div className="lobby-actions">
              <button onClick={createRoom}>Create Room</button>
              <div className="join-row">
                <input
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                  placeholder="Join code"
                />
                <button onClick={joinRoom}>Join Room</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2>Room: {roomCode}</h2>
            <div className="players">
              {(room?.players || []).map((p) => (
                <div key={p.userId} className="player-pill">
                  <span>{p.username}</span>
                  <span className={p.connected ? 'online' : 'offline'}>{p.connected ? 'online' : 'offline'}</span>
                </div>
              ))}
            </div>

            {room?.canStart ? (
              <div className="game-select">
                <p>Select game:</p>
                <div className="game-buttons">
                  {GAME_TYPES.map((g) => (
                    <button key={g.value} onClick={() => selectGame(g.value)}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p>Waiting for second player...</p>
            )}
          </>
        )}

        {game ? (
          <section className="board">
            <h3>{GAME_TYPES.find((g) => g.value === game.gameType)?.label || game.gameType}</h3>
            <p className="status">{game.message}</p>
            <p className="status">Turn: {game.turnUserId === user.id ? 'You' : 'Opponent'}</p>
            {game.roundNumber ? (
              <p className="status">
                Round: {game.roundNumber}/{game.totalRounds}
              </p>
            ) : null}
            {game.scores ? (
              <p className="status">
                Match score: You {game.scores[user.id] || 0} / Opponent{' '}
                {Object.entries(game.scores).find(([id]) => Number(id) !== user.id)?.[1] || 0}
              </p>
            ) : null}
            {game.roundOver && game.roundWinnerUserId !== undefined ? (
              <p className="winner">
                {game.roundWinnerUserId === null
                  ? 'Round tied.'
                  : game.roundWinnerUserId === user.id
                    ? 'You won the round.'
                    : 'Opponent won the round.'}
              </p>
            ) : null}
            {game.winnerUserId !== null ? (
              <p className="winner">{game.winnerUserId === user.id ? 'You win the match.' : 'Opponent wins the match.'}</p>
            ) : null}

            {'opponentCardCount' in game ? <p>Opponent cards: {game.opponentCardCount}</p> : null}
            {'deckCount' in game ? <p>Deck: {game.deckCount}</p> : null}
            {'discardCount' in game ? <p>Discard pile: {game.discardCount}</p> : null}
            {game.discardTop ? <p>Discard top: {cardLabel(game.discardTop)}</p> : null}
            {game.yourDeadwood !== undefined ? <p>Your deadwood: {game.yourDeadwood}</p> : null}
            {game.trumpSuit ? <p>Trump suit: {game.trumpSuit}</p> : null}
            {game.stockCount !== undefined ? <p>Stock: {game.stockCount}</p> : null}
            {game.upcard ? <p>Upcard: {cardLabel(game.upcard)}</p> : null}
            {game.stage ? <p>Stage: {game.stage === 'stock' ? 'Stock stage' : 'Endgame'}</p> : null}
            {game.secondStageTrickWins ? (
              <p>
                Tricks: You {game.secondStageTrickWins[user.id] || 0} / Opponent{' '}
                {Object.entries(game.secondStageTrickWins).find(([id]) => Number(id) !== user.id)?.[1] || 0}
              </p>
            ) : null}
            {game.topRule ? (
              <p>
                Rule: {game.topRule.type === 'any' ? 'Any rank' : game.topRule.type === 'max' ? `7 or lower` : 'Same or higher'}
              </p>
            ) : null}

            {game.currentTrick?.length ? (
              <p>
                Current trick:{' '}
                {game.currentTrick.map((t) => `${t.userId === user.id ? 'You' : 'Opp'}:${cardLabel(t.card)}`).join(' | ')}
              </p>
            ) : null}

            <div className="hand">
              {(game.yourHand || []).map((card) => {
                const selected = selectedIds.includes(card.id);
                return (
                  <button
                    key={card.id}
                    disabled={!isMyTurn || game.winnerUserId !== null || game.roundOver}
                    className={`card ${selected ? 'selected' : ''}`}
                    onClick={() => {
                      if (game.gameType === 'gin-rummy' && game.mustDiscard) {
                        act({ type: 'discard', cardId: card.id });
                        return;
                      }

                      if (game.gameType === 'german-whist') {
                        act({ type: 'play', cardId: card.id });
                        return;
                      }

                      setSelectedIds((prev) =>
                        prev.includes(card.id) ? prev.filter((id) => id !== card.id) : [...prev, card.id]
                      );
                    }}
                  >
                    {cardLabel(card)}
                  </button>
                );
              })}
            </div>

            {game.gameType === 'gin-rummy' && isMyTurn && game.winnerUserId === null && !game.roundOver ? (
              <div className="controls">
                <button disabled={game.mustDiscard} onClick={() => act({ type: 'draw', source: 'deck' })}>
                  Draw Deck
                </button>
                <button disabled={game.mustDiscard} onClick={() => act({ type: 'draw', source: 'discard' })}>
                  Draw Discard
                </button>
                <button disabled={!game.mustDiscard} onClick={() => act({ type: 'knock' })}>
                  Knock
                </button>
              </div>
            ) : null}
            {game.gameType === 'gin-rummy' && game.roundOver && game.winnerUserId === null ? (
              <div className="controls">
                <button onClick={() => act({ type: 'next-round' })}>Start Next Round</button>
              </div>
            ) : null}

            {game.gameType === 'shithead' && isMyTurn && game.winnerUserId === null ? (
              <div className="controls">
                <button
                  onClick={() => {
                    if (selectedRanks.length > 1) {
                      setError('Select cards of one rank only');
                      return;
                    }
                    if (!selectedIds.length) {
                      setError('Select at least one card');
                      return;
                    }
                    act({ type: 'play', cardIds: selectedIds });
                    setSelectedIds([]);
                  }}
                >
                  Play Selected
                </button>
                <button onClick={() => act({ type: 'take-pile' })}>Take Pile</button>
              </div>
            ) : null}

            {game.gameType === 'german-whist' ? <p>Tap a card in your hand to play.</p> : null}
          </section>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}
