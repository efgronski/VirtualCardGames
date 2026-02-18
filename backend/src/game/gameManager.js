import { ginRummyEngine } from './engines/ginRummy.js';
import { shitheadEngine } from './engines/shithead.js';
import { germanWhistEngine } from './engines/germanWhist.js';

const GAME_MAP = {
  'gin-rummy': ginRummyEngine,
  shithead: shitheadEngine,
  'german-whist': germanWhistEngine
};

export const GAME_TYPES = Object.keys(GAME_MAP);

export function createGameState(gameType, players) {
  const engine = GAME_MAP[gameType];
  if (!engine) throw new Error('Unsupported game');
  return engine.create(players);
}

export function applyGameAction(state, userId, action) {
  const engine = GAME_MAP[state.type];
  return engine.action(state, userId, action);
}

export function buildGameView(state, userId, players) {
  const engine = GAME_MAP[state.type];
  return engine.view(state, userId, players);
}
