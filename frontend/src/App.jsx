import { useEffect, useMemo, useReducer, useState } from 'react';
import { api } from './api';
import { connectSocket } from './socket';
import { solitaireReducer, dealKlondike3 } from './solitaire/klondike';
import { DICE_GAME_CATEGORIES } from './diceGame';
import { soloDiceGameReducer } from './soloDiceGame';

const GAME_TYPES = [
  { value: 'gin-rummy', label: 'Gin Rummy' },
  { value: 'shithead', label: 'Shithead' },
  { value: 'german-whist', label: 'German Whist' },
  { value: 'dice-game', label: 'Dice Game' }
];

const SOLO_GAMES = [
  { value: 'solitaire', label: 'Solitaire (Klondike 3-Draw)' },
  { value: 'dice-game', label: 'Solo Dice Game' }
];

const INVITE_QUERY_PARAM = 'room';

function normalizeRoomCode(code) {
  return String(code || '').trim().toUpperCase();
}

function getInviteCodeFromLocation() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return normalizeRoomCode(params.get(INVITE_QUERY_PARAM));
}

function setInviteCodeInUrl(code) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const normalized = normalizeRoomCode(code);
  if (normalized) {
    url.searchParams.set(INVITE_QUERY_PARAM, normalized);
  } else {
    url.searchParams.delete(INVITE_QUERY_PARAM);
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'absolute';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}

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

const DIE_PIPS = {
  1: ['center'],
  2: ['top-left', 'bottom-right'],
  3: ['top-left', 'center', 'bottom-right'],
  4: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  5: ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'],
  6: ['top-left', 'top-right', 'mid-left', 'mid-right', 'bottom-left', 'bottom-right']
};

function DieFace({ value, held = false }) {
  const pips = DIE_PIPS[value] || [];
  return (
    <div className={`die-face ${held ? 'held' : ''} ${value ? '' : 'empty'}`}>
      {value ? (
        <>
          {pips.map((pip) => (
            <span key={pip} className={`die-pip ${pip}`}></span>
          ))}
        </>
      ) : (
        <span className="die-face-placeholder">Roll</span>
      )}
    </div>
  );
}

function DiceCategoryIcon({ icon }) {
  return <span className="dice-category-icon">{icon}</span>;
}

function DiceGameBoard({ game, user, isMyTurn, act, isSolo = false, onNewGame }) {
  const orderedPlayers = [...(game.players || [])].sort((a, b) => Number(b.isViewer) - Number(a.isViewer));
  const viewerPanel = orderedPlayers.find((player) => player.isViewer);
  const scoreSections = [
    { key: 'upper', label: 'Upper Section', categories: DICE_GAME_CATEGORIES.slice(0, 6) },
    { key: 'lower', label: 'Lower Section', categories: DICE_GAME_CATEGORIES.slice(6) }
  ];
  const canRoll = Boolean(viewerPanel && isMyTurn && !game.gameOver && viewerPanel.rollsRemaining > 0);
  const canToggleHold = Boolean(
    viewerPanel &&
      isMyTurn &&
      !game.gameOver &&
      viewerPanel.rollsUsed > 0 &&
      viewerPanel.rollsRemaining > 0
  );
  const canScore = Boolean(viewerPanel && isMyTurn && !game.gameOver && viewerPanel.rollsUsed > 0);

  return (
    <section className="table-wrap dice-game-wrap">
      <div className="table-header">
        <h3>Dice Game</h3>
        <span className={`turn-pill ${isMyTurn ? 'yours' : ''}`}>
          {isSolo ? (game.gameOver ? 'Finished' : 'Solo Run') : game.gameOver ? 'Final Score' : isMyTurn ? 'Your Turn' : 'Opponent Turn'}
        </span>
      </div>

      <p className="status-text">
        {game.message}
        {game.forcedCategory ? ' Bonus 5-of-a-kind: the matching upper box must be used.' : ''}
        {game.extraFiveKindBonusReady ? ' Extra 5-of-a-kind bonus armed: scoring this roll will add 100 points.' : ''}
      </p>

      <div className="metrics">
        {viewerPanel ? <div className="metric">Rolls Left: {viewerPanel.rollsRemaining}</div> : null}
        {viewerPanel ? <div className="metric">Upper Bonus Goal: {viewerPanel.summary.upperSubtotal}/63</div> : null}
        {viewerPanel ? (
          <div className="metric">
            5 of a Kind Bonus:{' '}
            {viewerPanel.summary.fiveKindBonusAvailable
              ? `${viewerPanel.summary.fiveKindBonusCount}/${game.maxFiveKindBonuses} used (${viewerPanel.summary.fiveKindBonus} pts)`
              : 'Locked until first 5 of a Kind scores 50'}
          </div>
        ) : null}
        {game.openingTotals ? (
          <div className="metric">
            Opening Roll: You {game.openingTotals[user.id] || 0} - Opp{' '}
            {Object.entries(game.openingTotals).find(([id]) => Number(id) !== user.id)?.[1] || 0}
          </div>
        ) : null}
      </div>

      <div className="dice-board-grid">
        {orderedPlayers.map((player) => (
          <section
            key={player.userId}
            className={`dice-player-panel ${player.isViewer ? 'player-red' : 'player-blue'} ${
              player.isCurrentTurn ? 'active' : !game.gameOver ? 'dimmed' : ''
            } ${player.isViewer ? 'dice-viewer-panel dice-mobile-primary-panel' : 'dice-opponent-panel dice-mobile-secondary-panel'} ${
              player.isCurrentTurn ? 'dice-active-panel' : 'dice-inactive-panel'
            }`}
          >
            <div
              className={`dice-player-summary ${player.isViewer ? 'dice-viewer-summary' : 'dice-opponent-summary dice-opponent-mobile-summary'}`}
            >
              <div className="dice-player-header">
                <div>
                  <h4>{player.isViewer ? `${player.username} (You)` : player.username}</h4>
                  <p className="dice-player-status">
                    {player.isCurrentTurn
                      ? player.rollsUsed
                        ? `${player.rollsRemaining} roll${player.rollsRemaining === 1 ? '' : 's'} left`
                        : 'Ready to roll'
                      : `Completed ${player.summary.filledCount}/13 categories`}
                  </p>
                </div>
                <div className="dice-total-chip">Total {player.summary.total}</div>
              </div>
            </div>

            <div className={`dice-player-detail ${player.isViewer ? 'dice-viewer-detail' : 'dice-opponent-detail'}`}>
              <div className={`dice-score-region ${player.isViewer ? 'dice-viewer-score-region' : 'dice-opponent-score-region'}`}>
                <div className="dice-score-scroll">
                  <div className="dice-score-sections">
                    {scoreSections.map((section) => (
                      <section key={section.key} className="dice-score-section">
                        <div className="dice-score-section-header">
                          <span>{section.label}</span>
                        </div>
                        <div className="dice-score-list">
                          {section.categories.map((category) => {
                            const savedScore = player.categories[category.key];
                            const previewScore = player.isViewer ? game.yourPreviewScores?.[category.key] : undefined;
                            const forced = player.isViewer && game.forcedCategory === category.key;
                            const selectable =
                              player.isViewer &&
                              canScore &&
                              savedScore === null &&
                              (game.forcedCategory === null || forced);

                            return (
                              <button
                                key={category.key}
                                type="button"
                                disabled={!selectable}
                                className={`dice-score-row ${savedScore !== null ? 'locked complete' : 'open'} ${
                                  selectable ? 'selectable' : ''
                                } ${forced ? 'forced' : ''}`}
                                onClick={() => act({ type: 'score', category: category.key })}
                              >
                                <div className="dice-score-meta">
                                  <DiceCategoryIcon icon={category.icon} />
                                  <span>{category.label}</span>
                                </div>
                                <span className="dice-score-value">
                                  {savedScore !== null ? savedScore : previewScore ?? '--'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </div>

              <div className="dice-player-footer">
                <div className="dice-summary-grid">
                  <div className="dice-summary-card">
                    <span>Upper</span>
                    <strong>{player.summary.upperSubtotal}</strong>
                  </div>
                  <div className="dice-summary-card">
                    <span>Bonus</span>
                    <strong>{player.summary.upperBonus}</strong>
                  </div>
                  <div className="dice-summary-card">
                    <span>Lower</span>
                    <strong>{player.summary.lowerSubtotal}</strong>
                  </div>
                  <div className="dice-summary-card">
                    <span>5K Bonus</span>
                    <strong>{player.summary.fiveKindBonus}</strong>
                  </div>
                </div>

                <div className="dice-tray">
                  {player.dice.map((value, index) => {
                    const interactive = player.isViewer && canToggleHold;
                    const holdLabel = player.held[index]
                      ? 'Held'
                      : interactive
                        ? 'Tap to hold'
                        : player.isViewer && player.rollsUsed === 0
                          ? 'Roll first'
                          : 'Waiting';
                    return (
                      <button
                        key={`${player.userId}-die-${index}`}
                        type="button"
                        disabled={!interactive}
                        aria-pressed={player.held[index]}
                        className={`die-button ${player.held[index] ? 'held' : ''}`}
                        onClick={() => act({ type: 'toggle-hold', index })}
                      >
                        <DieFace value={value} held={player.held[index]} />
                        <span className="die-hold-label">{holdLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>

      {viewerPanel ? (
        <div className="controls dice-controls">
          {!game.gameOver ? (
            <button type="button" className="dice-roll-btn" disabled={!canRoll} onClick={() => act({ type: 'roll' })}>
              {viewerPanel.rollsUsed === 0 ? 'Roll Dice' : `Roll Again (${viewerPanel.rollsRemaining} left)`}
            </button>
          ) : null}
          {isSolo ? (
            <button type="button" onClick={onNewGame}>
              New Game
            </button>
          ) : null}
        </div>
      ) : null}

      {game.gameOver ? (
        <p className="winner-text">
          {isSolo
            ? `Final score: ${viewerPanel?.summary.total || 0}.`
            : game.winnerUserId === null
              ? 'Tie game.'
              : game.winnerUserId === user.id
                ? 'You win.'
                : 'Opponent wins.'}
        </p>
      ) : null}
    </section>
  );
}

export default function App() {
  const initialInviteCode = getInviteCodeFromLocation();
  const [username, setUsername] = useState('');
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });
  const [roomCodeInput, setRoomCodeInput] = useState(initialInviteCode);
  const [roomCode, setRoomCode] = useState(localStorage.getItem('roomCode') || '');
  const [room, setRoom] = useState(null);
  const [game, setGame] = useState(null);
  const [activeGameId, setActiveGameId] = useState(0);
  const [soloMode, setSoloMode] = useState(null);
  const [soloGame, dispatchSolitaire] = useReducer(solitaireReducer, undefined, dealKlondike3);
  const [soloDiceGame, dispatchSoloDiceGame] = useReducer(soloDiceGameReducer, null);
  const [error, setError] = useState('');
  const [soloFeedback, setSoloFeedback] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [knockDiscardMode, setKnockDiscardMode] = useState(false);
  const [handOrders, setHandOrders] = useState({});
  const [dragCardId, setDragCardId] = useState(null);
  const [showMobileLobbyMenu, setShowMobileLobbyMenu] = useState(Boolean(initialInviteCode));
  const [pendingInviteCode, setPendingInviteCode] = useState(initialInviteCode);
  const [inviteFeedback, setInviteFeedback] = useState('');
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!token) return;
    const s = connectSocket(token);

    const onRoomUpdate = (payload) => {
      setRoom(payload);
      if (payload?.code) {
        setRoomCode(payload.code);
        localStorage.setItem('roomCode', payload.code);
        setInviteCodeInUrl(payload.code);
      }
      if (payload?.gameId != null) {
        setActiveGameId(payload.gameId);
      }
    };
    const onGameUpdate = (payload) => {
      if (payload?.gameId != null) setActiveGameId(payload.gameId);
      setGame(payload);
      setSelectedIds([]);
      setKnockDiscardMode(false);
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

  useEffect(() => {
    if (!token || !pendingInviteCode || roomCode) return;
    joinRoom(pendingInviteCode, { fromInvite: true });
  }, [token, pendingInviteCode, roomCode]);

  const isMyTurn = game?.turnUserId === user?.id;
  const canReorderHand = game?.gameType === 'gin-rummy' || game?.gameType === 'german-whist';
  const availableGameTypes = GAME_TYPES.filter((gameType) => (room?.gameTypes || GAME_TYPES.map((g) => g.value)).includes(gameType.value));
  const activeInviteCode = roomCode || pendingInviteCode || roomCodeInput;
  const inviteLink =
    typeof window === 'undefined' || !activeInviteCode
      ? ''
      : `${window.location.origin}${window.location.pathname}?${INVITE_QUERY_PARAM}=${activeInviteCode}`;

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
      setSoloMode(null);
    try {
      const data = await api('/api/rooms', { method: 'POST', token });
      setRoomCode(data.code);
      localStorage.setItem('roomCode', data.code);
      setRoomCodeInput(data.code);
      setInviteCodeInUrl(data.code);
      setInviteFeedback('');
      const roomData = await api(`/api/rooms/${data.code}`, { token });
      setRoom(roomData);
      socket?.emit('room:subscribe', { code: data.code });
    } catch (err) {
      setError(err.message);
    }
  }

  async function joinRoom(codeValue = roomCodeInput, { fromInvite = false } = {}) {
    setError('');
    setSoloMode(null);
    const code = normalizeRoomCode(codeValue);
    if (!code) return;
    try {
      await api('/api/rooms/join', { method: 'POST', token, body: { code } });
      setRoomCode(code);
      localStorage.setItem('roomCode', code);
      setRoomCodeInput(code);
      setPendingInviteCode('');
      setInviteCodeInUrl(code);
      setInviteFeedback(fromInvite ? `Joined room ${code} from invite.` : '');
      const roomData = await api(`/api/rooms/${code}`, { token });
      setRoom(roomData);
      socket?.emit('room:subscribe', { code });
    } catch (err) {
      if (fromInvite) {
        setPendingInviteCode('');
        setRoomCodeInput(code);
        setShowMobileLobbyMenu(true);
      }
      setError(err.message);
    }
  }

  async function shareInviteLink() {
    if (!inviteLink) return;
    setInviteFeedback('');
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Join my card game',
          text: `Join my room with code ${activeInviteCode}.`,
          url: inviteLink
        });
        setInviteFeedback('Invite link shared.');
        return;
      }

      await copyText(inviteLink);
      setInviteFeedback('Invite link copied.');
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setError('Unable to share invite link right now.');
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    setInviteFeedback('');
    try {
      await copyText(inviteLink);
      setInviteFeedback('Invite link copied.');
    } catch {
      setError('Unable to copy invite link right now.');
    }
  }

  function selectGame(gameType) {
    if (!roomCode) return;
    setError('');
    setSoloMode(null);
    socket?.emit('game:select', { code: roomCode, gameType });
  }

  function act(action) {
    if (!roomCode) return;
    setError('');
    socket?.emit('game:action', { code: roomCode, gameId: activeGameId || undefined, action });
  }

  function moveHandCardInOrder(fromId, toId) {
    if (!gameKey || !fromId || !toId || fromId === toId) return;
    setHandOrders((prev) => {
      const order = [...(prev[gameKey] || [])];
      const fromIdx = order.indexOf(fromId);
      const toIdx = order.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, fromId);
      return { ...prev, [gameKey]: order };
    });
  }

  function discardDraggedCard() {
    if (!dragCardId || !game || game.gameType !== 'gin-rummy' || !isMyTurn || !game.mustDiscard) return;
    if (knockDiscardMode) {
      act({ type: 'knock-discard', cardId: dragCardId });
      setKnockDiscardMode(false);
    } else {
      act({ type: 'discard', cardId: dragCardId });
    }
    setDragCardId(null);
  }

  function clearToSoloMode(nextSoloMode) {
    setError('');
    if (roomCode) {
      socket?.emit('room:unsubscribe', { code: roomCode });
    }
    setRoomCode('');
    localStorage.removeItem('roomCode');
    setInviteCodeInUrl('');
    setRoom(null);
    setGame(null);
    setSelectedIds([]);
    setSoloFeedback('');
    setSoloMode(nextSoloMode);
  }

  function startSolitaire() {
    clearToSoloMode('solitaire');
    dispatchSolitaire({ type: 'NEW_GAME' });
  }

  function startSoloDiceGame() {
    clearToSoloMode('dice-game');
    dispatchSoloDiceGame({ type: 'new-game', userId: user.id, username: user.username });
  }

  function solitaireDraw() {
    dispatchSolitaire({ type: 'DRAW' });
  }

  function solitaireAutoWaste() {
    dispatchSolitaire({ type: 'AUTO_WASTE' });
  }

  function solitaireNewGame() {
    dispatchSolitaire({ type: 'NEW_GAME' });
  }

  function solitaireUndo() {
    dispatchSolitaire({ type: 'UNDO' });
  }

  function handleSoloDragStart(e, payload) {
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
  }

  function handleSoloDropOnTableau(e, toCol) {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (payload.type === 'waste') {
      dispatchSolitaire({ type: 'MOVE_WASTE_TO_TABLEAU', toCol });
    } else if (payload.type === 'tableau') {
      dispatchSolitaire({
        type: 'MOVE_TABLEAU_TO_TABLEAU',
        fromCol: payload.fromCol,
        startIndex: payload.startIndex,
        toCol
      });
    }
  }

  function handleSoloDropOnFoundation(e) {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (payload.type === 'waste') {
      dispatchSolitaire({ type: 'MOVE_WASTE_TO_FOUNDATION' });
    } else if (payload.type === 'tableau') {
      dispatchSolitaire({
        type: 'MOVE_TABLEAU_TO_FOUNDATION',
        fromCol: payload.fromCol,
        startIndex: payload.startIndex
      });
    }
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken('');
    setUser(null);
    setRoomCode('');
    localStorage.removeItem('roomCode');
    setInviteCodeInUrl('');
    setRoom(null);
    setGame(null);
    setSoloMode(null);
    setSelectedIds([]);
    dispatchSoloDiceGame({ type: 'new-game', userId: user.id, username: user.username });
  }

  useEffect(() => {
    if (soloMode !== 'solitaire' || !soloGame?.invalidMoveReason) return;
    setSoloFeedback(soloGame.invalidMoveReason);
    const t = setTimeout(() => setSoloFeedback(''), 900);
    return () => clearTimeout(t);
  }, [soloMode, soloGame?.invalidMoveTick]);

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
  const canKnock = game?.gameType === 'gin-rummy' && game.mustDiscard;
  const gameKey = game ? `${roomCode || 'no-room'}-${game.gameType}-${game.gameId || 0}` : null;

  useEffect(() => {
    if (!gameKey || !game?.yourHand) return;
    setHandOrders((prev) => {
      const existing = prev[gameKey] || [];
      const ids = game.yourHand.map((c) => c.id);
      const nextOrder = existing.filter((id) => ids.includes(id));
      for (const id of ids) {
        if (!nextOrder.includes(id)) nextOrder.push(id);
      }
      return { ...prev, [gameKey]: nextOrder };
    });
  }, [gameKey, game?.yourHand]);

  useEffect(() => {
    if (game?.gameType !== 'gin-rummy' || !game?.mustDiscard) {
      setKnockDiscardMode(false);
    }
  }, [game?.gameType, game?.mustDiscard]);

  const orderedHand = useMemo(() => {
    if (!game?.yourHand || !gameKey) return [];
    const byId = new Map(game.yourHand.map((c) => [c.id, c]));
    const order = handOrders[gameKey] || [];
    const out = order.map((id) => byId.get(id)).filter(Boolean);
    for (const card of game.yourHand) {
      if (!out.find((c) => c.id === card.id)) out.push(card);
    }
    return out;
  }, [game?.yourHand, gameKey, handOrders]);

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

        <div className="board-content-shell">
          {!roomCode ? (
            <section className="lobby-menu-shell">
              <div className="mobile-lobby-bar">
                <button
                  type="button"
                  className="mobile-lobby-toggle"
                  aria-expanded={showMobileLobbyMenu}
                  onClick={() => setShowMobileLobbyMenu((value) => !value)}
                >
                  {showMobileLobbyMenu ? 'Close Menu' : 'Menu'}
                </button>
              </div>

              {pendingInviteCode && !roomCode ? (
                <div className="invite-banner">
                  <strong>Invite ready:</strong> Room {pendingInviteCode}
                </div>
              ) : null}

              <div className={`lobby-actions ${showMobileLobbyMenu ? 'mobile-open' : ''}`}>
                <button onClick={createRoom}>Create Room</button>
                {SOLO_GAMES.map((soloGameOption) => (
                  <button
                    key={soloGameOption.value}
                    onClick={soloGameOption.value === 'solitaire' ? startSolitaire : startSoloDiceGame}
                  >
                    {soloGameOption.label}
                  </button>
                ))}
                <div className="join-row">
                  <input
                    value={roomCodeInput}
                    onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                    placeholder="Join code"
                  />
                  <button onClick={joinRoom}>Join Room</button>
                </div>
              </div>
            </section>
          ) : (
            <section>
              <div className="room-heading">
                <h2>Room {roomCode}</h2>
                <div className="room-link-actions">
                  <button type="button" onClick={shareInviteLink}>
                    Share Invite
                  </button>
                  <button type="button" onClick={copyInviteLink}>
                    Copy Link
                  </button>
                </div>
              </div>
              {inviteFeedback ? <p className="invite-feedback">{inviteFeedback}</p> : null}
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
                  {availableGameTypes.map((g) => (
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

          {soloMode === 'solitaire' ? (
            <section className="table-wrap">
              <div className="table-header">
                <h3>{SOLO_GAMES[0].label}</h3>
                <span className={`turn-pill ${soloGame.won ? 'yours' : ''}`}>{soloGame.won ? 'Solved' : 'In Progress'}</span>
              </div>
              <p className="status-text">Classic Klondike 3-card draw: build tableau down alternating colors, foundations A to K by suit.</p>
              <div className="metrics">
                <div className="metric">Deck: {soloGame.stock.length}</div>
                <div className="metric">Waste: {soloGame.waste.length}</div>
                <div className="metric">
                  Foundation: {Object.values(soloGame.foundations).reduce((sum, cards) => sum + cards.length, 0)}
                </div>
                <div className="metric">Undo: {soloGame.history.length}</div>
              </div>
              <div className="controls">
                <button onClick={solitaireNewGame}>New Game</button>
                <button onClick={solitaireUndo}>Undo</button>
              </div>
              {soloFeedback ? <p className="error shake">{soloFeedback}</p> : null}

              <div className="solitaire-top">
                <div className="solitaire-stock-waste">
                  <div className="pile-card">
                    <div className="zone-title">Stock</div>
                    <button className="card-btn" onClick={solitaireDraw}>
                      {soloGame.stock.length ? <CardVisual faceDown /> : <div className="trick-wait">Recycle</div>}
                    </button>
                  </div>
                  <div className="pile-card">
                    <div className="zone-title">Waste (Top Playable)</div>
                    <div className="waste-fan">
                      {soloGame.waste.slice(-3).map((card, idx, arr) => (
                        <button
                          key={card.id + idx}
                          draggable={idx === arr.length - 1}
                          onDragStart={(e) => handleSoloDragStart(e, { type: 'waste' })}
                          onClick={() => idx === arr.length - 1 && solitaireAutoWaste()}
                          className="card-btn waste-card"
                          style={{ transform: `translateX(${idx * 22}px)` }}
                        >
                          <CardVisual card={card} />
                        </button>
                      ))}
                      {soloGame.waste.length === 0 ? <div className="trick-wait">Empty</div> : null}
                    </div>
                  </div>
                </div>
                <div className="solitaire-foundations">
                  {['S', 'H', 'D', 'C'].map((suit) => (
                    <div
                      key={suit}
                      className="pile-card foundation-drop"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleSoloDropOnFoundation}
                    >
                      <div className="zone-title">Foundation {suit}</div>
                      {soloGame.foundations[suit].length ? (
                        <CardVisual card={soloGame.foundations[suit][soloGame.foundations[suit].length - 1]} />
                      ) : (
                        <div className="trick-wait">{suit}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="solitaire-tableau">
                {soloGame.tableau.map((col, colIdx) => (
                  <div
                    key={`col-${colIdx}`}
                    className="tableau-col"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleSoloDropOnTableau(e, colIdx)}
                  >
                    <div className="zone-title">Column {colIdx + 1}</div>
                    <div className="tableau-stack">
                      {col.down.map((card, downIdx) => (
                        <div key={`down-${card.id}-${downIdx}`} className="tableau-card" style={{ top: `${downIdx * 18}px` }}>
                          <CardVisual faceDown />
                        </div>
                      ))}
                      {col.up.map((card, upIdx) => (
                        <button
                          key={`up-${card.id}-${upIdx}`}
                          className="card-btn tableau-card"
                          draggable
                          onDragStart={(e) => handleSoloDragStart(e, { type: 'tableau', fromCol: colIdx, startIndex: upIdx })}
                          onClick={() => dispatchSolitaire({ type: 'AUTO_TABLEAU', fromCol: colIdx, upIndex: upIdx })}
                          style={{ top: `${(col.down.length + upIdx) * 24}px` }}
                        >
                          <CardVisual card={card} />
                        </button>
                      ))}
                      {col.down.length === 0 && col.up.length === 0 ? <div className="trick-wait tableau-empty">K</div> : null}
                    </div>
                  </div>
                ))}
              </div>
              {soloGame.won ? <p className="winner-text">You solved it.</p> : null}
            </section>
          ) : soloMode === 'dice-game' && soloDiceGame ? (
            <DiceGameBoard
              game={soloDiceGame}
              user={user}
              isMyTurn
              act={(action) => dispatchSoloDiceGame(action)}
              isSolo
              onNewGame={() => dispatchSoloDiceGame({ type: 'new-game', userId: user.id, username: user.username })}
            />
          ) : game?.gameType === 'dice-game' ? (
            <DiceGameBoard game={game} user={user} isMyTurn={isMyTurn} act={act} />
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
                    <div
                      className={`pile-card ${game.gameType === 'gin-rummy' && isMyTurn && game.mustDiscard ? 'drop-active' : ''}`}
                      onDragOver={(e) => {
                        if (game.gameType === 'gin-rummy' && isMyTurn && game.mustDiscard) e.preventDefault();
                      }}
                      onDrop={discardDraggedCard}
                    >
                      <div className="zone-title">Discard Pile</div>
                      <CardVisual card={game.discardTop} />
                      {game.gameType === 'gin-rummy' && isMyTurn && game.mustDiscard ? (
                        <div className="zone-title">{knockDiscardMode ? 'Drop card to knock' : 'Drop card to discard'}</div>
                      ) : null}
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
                  {(orderedHand || []).map((card) => {
                    const selected = selectedIds.includes(card.id);
                    const actionDisabled = !isMyTurn || game.winnerUserId !== null || game.roundOver || game.isResolving;
                    const reorderDisabled = game.winnerUserId !== null || game.roundOver || game.isResolving;
                    const disabled = !canReorderHand && actionDisabled;

                    return (
                      <button
                        key={card.id}
                        disabled={disabled}
                        className={`card-btn ${selected ? 'selected' : ''}`}
                        draggable={
                          (!reorderDisabled && canReorderHand) ||
                          (game.gameType === 'gin-rummy' && isMyTurn && game.mustDiscard)
                        }
                        onDragStart={(e) => {
                          setDragCardId(card.id);
                          e.dataTransfer.setData('text/plain', card.id);
                        }}
                        onDragEnd={() => setDragCardId(null)}
                        onDragOver={(e) => {
                          if (canReorderHand) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          if (!canReorderHand) return;
                          e.preventDefault();
                          const fromId = e.dataTransfer.getData('text/plain') || dragCardId;
                          moveHandCardInOrder(fromId, card.id);
                        }}
                        onClick={() => {
                          if (actionDisabled) return;
                          if (game.gameType === 'gin-rummy' && game.mustDiscard) {
                            // Discard is drag-and-drop only to prevent accidental clicks.
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
                  <button className="draw-deck-btn" disabled={game.mustDiscard} onClick={() => act({ type: 'draw', source: 'deck' })}>
                    Draw Deck
                  </button>
                  <button
                    className="draw-discard-btn"
                    disabled={game.mustDiscard}
                    onClick={() => act({ type: 'draw', source: 'discard' })}
                  >
                    Draw Discard
                  </button>
                  <button
                    className="knock-discard-btn"
                    disabled={!canKnock}
                    onClick={() => {
                      setKnockDiscardMode((v) => !v);
                    }}
                  >
                    {knockDiscardMode ? 'Cancel Knock' : 'Knock by Discard'}
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
        </div>
      </section>
    </main>
  );
}
