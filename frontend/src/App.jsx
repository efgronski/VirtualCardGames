import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { connectSocket } from './socket';

const GAME_TYPES = [
  { value: 'gin-rummy', label: 'Gin Rummy' },
  { value: 'shithead', label: 'Shithead' },
  { value: 'german-whist', label: 'German Whist' }
];

const SOLO_GAME = { value: 'solitaire', label: 'Solitaire' };

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

function makeDeck() {
  const suits = ['S', 'H', 'D', 'C'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) deck.push({ id: `${rank}${suit}`, rank, suit });
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function solitaireRank(rank) {
  const order = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return order.indexOf(rank) + 1;
}

function createSolitaireState() {
  return {
    deck: makeDeck(),
    waste: [],
    foundations: { S: [], H: [], D: [], C: [] },
    won: false
  };
}

function canMoveToFoundation(card, foundation) {
  if (!card) return false;
  if (foundation.length === 0) return card.rank === 'A';
  const top = foundation[foundation.length - 1];
  return card.suit === top.suit && solitaireRank(card.rank) === solitaireRank(top.rank) + 1;
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
  const [activeGameId, setActiveGameId] = useState(0);
  const [soloGame, setSoloGame] = useState(null);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!token) return;
    const s = connectSocket(token);

    const onRoomUpdate = (payload) => {
      setRoom(payload);
      if (payload?.code) {
        setRoomCode(payload.code);
        localStorage.setItem('roomCode', payload.code);
      }
      if (payload?.gameId != null) {
        setActiveGameId(payload.gameId);
      }
    };
    const onGameUpdate = (payload) => {
      if (payload?.gameId != null) setActiveGameId(payload.gameId);
      setGame(payload);
      setSelectedIds([]);
      setError('');
    };
    const onGameReinit = ({ code, gameId }) => {
      if (code && roomCode && code !== roomCode) return;
      setGame(null);
      setSelectedIds([]);
      setActiveGameId(gameId || 0);
      if (code) {
        s.emit('room:subscribe', { code });
        s.emit('game:snapshot', { code, gameId });
      }
    };
    const onConnect = () => {
      const storedRoomCode = localStorage.getItem('roomCode');
      if (storedRoomCode) {
        s.emit('room:subscribe', { code: storedRoomCode });
        s.emit('game:snapshot', { code: storedRoomCode });
      }
    };

    s.on('room:update', onRoomUpdate);
    s.on('game:update', onGameUpdate);
    s.on('game:reinit', onGameReinit);
    s.on('connect', onConnect);
    s.on('error:message', (msg) => setError(msg));

    setSocket(s);
    return () => {
      s.off('room:update', onRoomUpdate);
      s.off('game:update', onGameUpdate);
      s.off('game:reinit', onGameReinit);
      s.off('connect', onConnect);
      s.disconnect();
      setSocket(null);
    };
  }, [token]);

  useEffect(() => {
    if (!socket || !roomCode) return;
    socket.emit('room:subscribe', { code: roomCode });
    socket.emit('game:snapshot', { code: roomCode, gameId: activeGameId || undefined });
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
    setSoloGame(null);
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
    setSoloGame(null);
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
    setSoloGame(null);
    socket?.emit('game:select', { code: roomCode, gameType });
  }

  function act(action) {
    if (!roomCode) return;
    setError('');
    socket?.emit('game:action', { code: roomCode, gameId: activeGameId || undefined, action });
  }

  function startSolitaire() {
    setError('');
    if (roomCode) {
      socket?.emit('room:unsubscribe', { code: roomCode });
    }
    setRoomCode('');
    localStorage.removeItem('roomCode');
    setRoom(null);
    setGame(null);
    setSelectedIds([]);
    setSoloGame(createSolitaireState());
  }

  function solitaireDraw() {
    setSoloGame((prev) => {
      if (!prev) return prev;
      if (prev.deck.length > 0) {
        const nextDeck = [...prev.deck];
        const card = nextDeck.shift();
        return { ...prev, deck: nextDeck, waste: [card, ...prev.waste] };
      }
      if (prev.waste.length <= 1) return prev;
      const recycle = [...prev.waste].reverse();
      const top = recycle.shift();
      return { ...prev, deck: recycle, waste: [top] };
    });
  }

  function solitaireToFoundation() {
    setSoloGame((prev) => {
      if (!prev || prev.won || prev.waste.length === 0) return prev;
      const [top, ...restWaste] = prev.waste;
      const foundation = prev.foundations[top.suit];
      if (!canMoveToFoundation(top, foundation)) return prev;

      const nextFoundations = {
        ...prev.foundations,
        [top.suit]: [...foundation, top]
      };
      const total = Object.values(nextFoundations).reduce((sum, cards) => sum + cards.length, 0);
      return {
        ...prev,
        waste: restWaste,
        foundations: nextFoundations,
        won: total === 52
      };
    });
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
    setSoloGame(null);
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
            <button onClick={startSolitaire}>{SOLO_GAME.label}</button>
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

        {soloGame ? (
          <section className="table-wrap">
            <div className="table-header">
              <h3>{SOLO_GAME.label}</h3>
              <span className={`turn-pill ${soloGame.won ? 'yours' : ''}`}>{soloGame.won ? 'Solved' : 'In Progress'}</span>
            </div>
            <p className="status-text">Draw cards and move the waste card to foundation in suit order (A to K).</p>
            <div className="metrics">
              <div className="metric">Deck: {soloGame.deck.length}</div>
              <div className="metric">Waste: {soloGame.waste.length}</div>
              <div className="metric">
                Foundation: {Object.values(soloGame.foundations).reduce((sum, cards) => sum + cards.length, 0)}
              </div>
            </div>
            <div className="table-zone">
              <div className="opponent-zone">
                <div className="zone-title">Deck</div>
                <div className="hand-grid">
                  {soloGame.deck.length ? <CardVisual faceDown /> : <div className="trick-wait">Empty</div>}
                </div>
                <div className="controls">
                  <button onClick={solitaireDraw}>Draw</button>
                </div>
              </div>
              <div className="middle-zone">
                <div className="pile-card">
                  <div className="zone-title">Waste</div>
                  {soloGame.waste[0] ? <CardVisual card={soloGame.waste[0]} /> : <div className="trick-wait">Empty</div>}
                </div>
                <div className="pile-card">
                  <div className="zone-title">Foundations</div>
                  <div className="hand-grid">
                    {['S', 'H', 'D', 'C'].map((suit) =>
                      soloGame.foundations[suit].length ? (
                        <CardVisual key={suit} card={soloGame.foundations[suit][soloGame.foundations[suit].length - 1]} />
                      ) : (
                        <div key={suit} className="trick-wait">
                          {suit}
                        </div>
                      )
                    )}
                  </div>
                  <div className="controls">
                    <button onClick={solitaireToFoundation}>Move Waste to Foundation</button>
                  </div>
                </div>
              </div>
            </div>
            {soloGame.won ? <p className="winner-text">You solved it.</p> : null}
          </section>
        ) : game ? (
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
                {game.gameType === 'gin-rummy' && game.roundOver && game.opponentHand ? (
                  <div className="hand-grid">
                    {game.opponentHand.map((card) => (
                      <CardVisual key={`opp-${card.id}`} card={card} />
                    ))}
                  </div>
                ) : (
                  <BackStack count={game.opponentCardCount || 0} />
                )}
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
