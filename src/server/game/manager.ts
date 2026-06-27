// Gerenciador do estado de jogo compartilhado: lê do store, aplica mutações,
// persiste e monta o PublicState transmitido aos clientes.

import type {
  BattleSnapshot,
  BattleState,
  GameState,
  Initiative,
  PublicState,
  Roll,
  Token,
} from "@/game/types";
import { chargeRegen, clampDistortion, maxCharges } from "@/game/rules";
import {
  getBattleTemplates,
  getCharacters,
  getDisguises,
  getGame,
  getHacks,
  getItems,
  getNpcs,
  getObjects,
  getProfessions,
  getScenarios,
  getUsers,
  saveGame,
} from "../data/store";

export function buildPublicState(): PublicState {
  return {
    game: getGame(),
    scenarios: getScenarios(),
    professions: getProfessions(),
    items: getItems(),
    hacks: getHacks(),
    disguises: getDisguises(),
    npcs: getNpcs(),
    objects: getObjects(),
    battleTemplates: getBattleTemplates(),
    characters: getCharacters(),
    players: getUsers().map((u) => ({ id: u.id, email: u.email, role: u.role })),
  };
}

async function mutate(fn: (g: GameState) => void): Promise<void> {
  const g = getGame();
  fn(g);
  await saveGame(g);
}

// --- Modo cenário ---

export async function setScenario(scenarioId: string): Promise<void> {
  const scn = getScenarios().find((s) => s.id === scenarioId);
  await mutate((g) => {
    g.scenarioId = scenarioId;
    if (scn) g.distortion = clampDistortion(scn.distortion);
  });
}

export async function setDistortion(value: number): Promise<void> {
  const v = clampDistortion(value);
  await mutate((g) => {
    g.distortion = v;
    const scn = getScenarios().find((s) => s.id === g.scenarioId);
    if (scn) scn.distortion = v;
  });
}

// --- Batalha ---

/** Duração máxima de um turno antes do pulo automático (ms). */
export const TURN_DURATION_MS = 3 * 60 * 1000;

function snapshot(g: GameState): BattleSnapshot {
  const b = g.battle!;
  return {
    turnIndex: b.turnIndex,
    tokens: JSON.parse(JSON.stringify(b.tokens)),
    distortion: g.distortion,
  };
}

/** Nível de um token: jogador pela ficha, inimigo pelo NPC do catálogo. */
function tokenLevel(token: Token): number {
  if (token.characterId) {
    return getCharacters().find((c) => c.id === token.characterId)?.level ?? 0;
  }
  if (token.npcId) {
    return getNpcs().find((n) => n.id === token.npcId)?.level ?? 0;
  }
  return 0;
}

/** Regenera as cargas de distorção do ator atual (jogador ou inimigo). */
function regenCurrentActor(b: BattleState): void {
  const entry = b.initiative[b.turnIndex];
  if (!entry) return;
  const tok = b.tokens.find((t) => t.id === entry.tokenId);
  if (!tok || (tok.kind !== "player" && tok.kind !== "enemy")) return;
  const lvl = tokenLevel(tok);
  tok.charges = Math.min(maxCharges(lvl), (tok.charges ?? 0) + chargeRegen(lvl));
}

export async function startBattle(grid: number, tokens: Token[]): Promise<void> {
  const size = Math.max(4, Math.min(7, Math.round(grid)));
  // Jogadores e inimigos começam com as cargas cheias do seu nível.
  for (const t of tokens) {
    if (t.kind === "player" || t.kind === "enemy") t.charges = maxCharges(tokenLevel(t));
  }
  await mutate((g) => {
    const battle: BattleState = {
      grid: size,
      tokens,
      initiative: [],
      turnIndex: 0,
      turnEndsAt: 0,
      history: [],
      log: ["Batalha iniciada."],
    };
    g.battle = battle;
    g.mode = "battle";
  });
}

export async function endBattle(): Promise<void> {
  await mutate((g) => {
    g.battle = null;
    g.mode = "scenario";
  });
}

export async function updateTokens(tokens: Token[]): Promise<void> {
  await mutate((g) => {
    if (g.battle) g.battle.tokens = tokens;
  });
}

export async function setInitiative(initiative: Initiative[]): Promise<void> {
  await mutate((g) => {
    if (!g.battle) return;
    g.battle.initiative = [...initiative].sort((a, b) => b.value - a.value);
    g.battle.turnIndex = 0;
    g.battle.turnEndsAt = Date.now() + TURN_DURATION_MS;
    g.battle.history = [snapshot(g)];
  });
}

export async function advanceTurn(dir: 1 | -1): Promise<void> {
  await mutate((g) => {
    const b = g.battle;
    if (!b || b.initiative.length === 0) return;

    if (dir === 1) {
      // Salva o turno atual no histórico antes de avançar.
      b.turnIndex = (b.turnIndex + 1) % b.initiative.length;
      b.history.push(snapshot(g));
    } else {
      // Retrocede: restaura o snapshot anterior (tudo volta a ser como era).
      if (b.history.length > 1) {
        b.history.pop();
        const prev = b.history[b.history.length - 1];
        b.turnIndex = prev.turnIndex;
        b.tokens = JSON.parse(JSON.stringify(prev.tokens));
        g.distortion = prev.distortion;
      }
    }
    // Reinicia o contador a cada mudança de turno (inclusive ao voltar o histórico).
    b.turnEndsAt = Date.now() + TURN_DURATION_MS;
    // Avançar concede as cargas de distorção do novo ator (retroceder não).
    if (dir === 1) regenCurrentActor(b);
  });
}

/**
 * Remove tokens do mapa (mortos ou objetos consumidos) e suas entradas de
 * iniciativa, mantendo o turno apontando para o ator informado.
 */
export async function removeTokens(ids: string[], keepActorId: string): Promise<void> {
  if (ids.length === 0) return;
  await mutate((g) => {
    const b = g.battle;
    if (!b) return;
    const remove = new Set(ids);
    b.tokens = b.tokens.filter((t) => !remove.has(t.id));
    b.initiative = b.initiative.filter((i) => !remove.has(i.tokenId));
    const idx = b.initiative.findIndex((i) => i.tokenId === keepActorId);
    if (idx >= 0) b.turnIndex = idx;
    else if (b.turnIndex >= b.initiative.length) b.turnIndex = 0;
  });
}

export async function appendLog(line: string): Promise<void> {
  await mutate((g) => {
    if (g.battle) g.battle.log.push(line);
  });
}

export async function setLastRoll(roll: Roll): Promise<void> {
  await mutate((g) => {
    g.lastRoll = roll;
  });
}
