import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { connectSocket } from './socket';

const GAME_TYPES = [
  { value: 'gin-rummy', label: 'Gin Rummy' },
  { value: 'shithead', label: 'Shithead' },
  { value: 'german-whist', label: 'German Whist' }
];

function toCid(card) {
  if (!card) return '';
  const rank = card.rank === '10' ? 'T' : card.rank;
  return `${rank}${String(card.suit || '').toLowerCase()}`;
}

function CardVisual({ card, faceDown = false }) {
  const cid = faceDown ? '00' : toCid(card);
  return (
    <div className="card-shell" aria-label={faceDown ? 'Face-down card' : `${card.rank}${card.suit}`}>
      <playing-card cid={cid}></playing-card>
      <span className="card-fallback">{faceDown ? '🂠' : `${card.rank}${card.suit}`}</span>
    </div>
  );
}

function BackStack({ count }) {
  const visible = Math.min(count, 10);
  return (
    <div className="back-stack" aria-label={`Opponent has ${count} cards`}>
      {Array.from({ length: visible }).map((_, i) => (
        <div key={i} className="stack-card" style={{ transform: `translateX(${i * 18}px)` }}>
          <CardVisual faceDown />
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [username, setUsername] = useState('');
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roomCode, setRoomCode] = useState(localStorage.getItem('roomCode') || '');
  const [room, setRoom] = useState(null);
  const [game, setGame] = useState(null);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!token) return;
    const s = connectSocket(token);

    s.on('room:update', (payload) => {
      setRoom(payload);
      if (payload?.code) {
        setRoomCode(payload.code);
        localStorage.setItem('roomCode', payload.code);
      }
    });
    s.on('game:update', (payload) => {
      setGame(payload);
      setSelectedIds([]);
      setError('');
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
      const data = await api('/api/auth/guest', {
        method: 'POST',
        body: { username }
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
      localStorage.setItem('roomCode', data.code);
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
      localStorage.setItem('roomCode', code);
      const roomData = await api(`/api/rooms/${code}`, { token });
      setRoom(roomData);
      socket?.emit('room:subscribe', { code });
    } catch (err) {
      setError(err.message);
    }
  }

  function selectGame(gameType) {
    if (!roomCode) return;
    setError('');
    socket?.emit('game:select', { code: roomCode, gameType });
  }

  function act(action) {
    if (!roomCode) return;
    setError('');
    socket?.emit('game:action', { code: roomCode, action });
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken('');
    setUser(null);
    setRoomCode('');
    localStorage.removeItem('roomCode');
    setRoom(null);
    setGame(null);
    setSelectedIds([]);
  }

  const selectedRanks = useMemo(() => {
    const cards = game?.yourHand?.filter((c) => selectedIds.includes(c.id)) || [];
    return [...new Set(cards.map((c) => c.rank))];
  }, [game?.yourHand, selectedIds]);

  const opponentScore = game?.scores
    ? Object.entries(game.scores).find(([id]) => Number(id) !== user.id)?.[1] || 0
    : 0;

  const opponentTricks = game?.secondStageTrickWins
    ? Object.entries(game.secondStageTrickWins).find(([id]) => Number(id) !== user.id)?.[1] || 0
    : 0;
  const canKnock = game?.gameType === 'gin-rummy' && game.mustDiscard && game.yourDeadwood <= 10;

  if (!token || !user) {
    return (
      <main className="page auth-page">
        <section className="panel auth-panel">
          <h1>Virtual Card Games</h1>
          <p>Choose a unique username currently in use on the site.</p>
          <form onSubmit={handleAuth}>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" required />
            <button type="submit">Enter Lobby</button>
          </form>
          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="panel board-panel">
        <div className="top-row">
          <h1>Virtual Card Games</h1>
          <div className="top-actions">
            <span className="user-chip">{user.username}</span>
            <button className="link" onClick={logout}>
              Logout
            </button>
          </div>
        </div>

        {!roomCode ? (
          <section className="lobby-actions">
            <button onClick={createRoom}>Create Room</button>
            <div className="join-row">
              <input
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                placeholder="Join code"
              />
              <button onClick={joinRoom}>Join Room</button>
            </div>
          </section>
        ) : (
          <section>
            <h2>Room {roomCode}</h2>
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
                {GAME_TYPES.map((g) => (
                  <button key={g.value} onClick={() => selectGame(g.value)}>
                    {g.label}
                  </button>
                ))}
              </div>
            ) : (
              <p>Waiting for second player...</p>
            )}
          </section>
        )}

        {game ? (
          <section className="table-wrap">
            <div className="table-header">
              <h3>{GAME_TYPES.find((g) => g.value === game.gameType)?.label || game.gameType}</h3>
              <span className={`turn-pill ${isMyTurn ? 'yours' : ''}`}>{isMyTurn ? 'Your Turn' : 'Opponent Turn'}</span>
            </div>

            <p className="status-text">{game.message}</p>

            <div className="metrics">
              {'deckCount' in game ? <div className="metric">Deck: {game.deckCount}</div> : null}
              {'stockCount' in game ? <div className="metric">Stock: {game.stockCount}</div> : null}
              {'discardCount' in game ? <div className="metric">Discard: {game.discardCount}</div> : null}
              {game.bombsUsed !== undefined ? <div className="metric">Number of Bombs: {game.bombsUsed}</div> : null}
              {game.trumpSuit ? <div className="metric">Trump: {game.trumpSuit}</div> : null}
              {game.yourDeadwood !== undefined ? <div className="metric">Deadwood: {game.yourDeadwood}</div> : null}
              {game.roundNumber ? (
                <div className="metric">
                  Round {game.roundNumber}/{game.totalRounds}
                </div>
              ) : null}
              {game.scores ? <div className="metric">Score: You {game.scores[user.id] || 0} - Opp {opponentScore}</div> : null}
              {game.secondStageTrickWins ? (
                <div className="metric">Endgame tricks: You {game.secondStageTrickWins[user.id] || 0} - Opp {opponentTricks}</div>
              ) : null}
              {game.topRule ? (
                <div className="metric">
                  Rule: {game.topRule.type === 'any' ? 'Any rank' : game.topRule.type === 'max' ? '7 or lower' : 'Same or higher'}
                </div>
              ) : null}
              {game.discardTop?.rank === '3' && game.effectiveTopRank ? (
                <div className="metric">3 mirrors: {game.effectiveTopRank}</div>
              ) : null}
            </div>

            <div className="table-zone">
              <div className="opponent-zone">
                <div className="zone-title">Opponent</div>
                <BackStack count={game.opponentCardCount || 0} />
              </div>

              <div className="middle-zone">
                {game.discardTop ? (
                  <div className="pile-card">
                    <div className="zone-title">Discard Pile</div>
                    <CardVisual card={game.discardTop} />
                  </div>
                ) : null}
                {game.upcard ? (
                  <div className="pile-card">
                    <div className="zone-title">Upcard</div>
                    <CardVisual card={game.upcard} />
                  </div>
                ) : null}
              </div>
            </div>

            {game.currentTrick?.length > 0 ? (
              <div className="trick-board">
                <div
                  className={`trick-slot ${
                    game.currentTrick[0] && game.lastTrick?.winnerUserId === game.currentTrick[0].userId ? 'winner' : ''
                  }`}
                >
                  <div className="zone-title">{game.currentTrick[0]?.userId === user.id ? 'You' : 'Opponent'}</div>
                  {game.currentTrick[0] ? <CardVisual card={game.currentTrick[0].card} /> : null}
                </div>
                <div
                  className={`trick-slot ${
                    game.currentTrick[1] && game.lastTrick?.winnerUserId === game.currentTrick[1].userId ? 'winner' : ''
                  }`}
                >
                  <div className="zone-title">{game.currentTrick[1]?.userId === user.id ? 'You' : 'Opponent'}</div>
                  {game.currentTrick[1] ? <CardVisual card={game.currentTrick[1].card} /> : <div className="trick-wait">Waiting...</div>}
                </div>
              </div>
            ) : game.lastTrick?.cards?.length === 2 ? (
              <div className="trick-board">
                <div className={`trick-slot ${game.lastTrick.cards[0].userId === game.lastTrick.winnerUserId ? 'winner' : ''}`}>
                  <div className="zone-title">{game.lastTrick.cards[0].userId === user.id ? 'You' : 'Opponent'}</div>
                  <CardVisual card={game.lastTrick.cards[0].card} />
                </div>
                <div className={`trick-slot ${game.lastTrick.cards[1].userId === game.lastTrick.winnerUserId ? 'winner' : ''}`}>
                  <div className="zone-title">{game.lastTrick.cards[1].userId === user.id ? 'You' : 'Opponent'}</div>
                  <CardVisual card={game.lastTrick.cards[1].card} />
                </div>
              </div>
            ) : null}

            <div className="your-zone">
              <div className="zone-title">Your Hand</div>
              <div className="hand-grid">
                {(game.yourHand || []).map((card) => {
                  const selected = selectedIds.includes(card.id);
                  const disabled = !isMyTurn || game.winnerUserId !== null || game.roundOver || game.isResolving;

                  return (
                    <button
                      key={card.id}
                      disabled={disabled}
                      className={`card-btn ${selected ? 'selected' : ''}`}
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
                      <CardVisual card={card} />
                    </button>
                  );
                })}
              </div>
            </div>

            {game.gameType === 'gin-rummy' && isMyTurn && game.winnerUserId === null && !game.roundOver ? (
              <div className="controls">
                <button disabled={game.mustDiscard} onClick={() => act({ type: 'draw', source: 'deck' })}>
                  Draw Deck
                </button>
                <button disabled={game.mustDiscard} onClick={() => act({ type: 'draw', source: 'discard' })}>
                  Draw Discard
                </button>
                <button disabled={!canKnock} onClick={() => act({ type: 'knock' })}>
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
                <button className="danger-btn" onClick={() => act({ type: 'take-pile' })}>
                  Take Pile
                </button>
              </div>
            ) : null}

            {game.winnerUserId !== null ? (
              <p className="winner-text">{game.winnerUserId === user.id ? 'You win.' : 'Opponent wins.'}</p>
            ) : null}
            {game.roundOver && game.roundWinnerUserId !== undefined ? (
              <p className="winner-text">
                {game.roundWinnerUserId === null
                  ? 'Round tied.'
                  : game.roundWinnerUserId === user.id
                    ? 'You won the round.'
                    : 'Opponent won the round.'}
              </p>
            ) : null}
          </section>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}
