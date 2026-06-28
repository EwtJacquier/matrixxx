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
  getMusic,
  getNpcs,
  getObjects,
  getProfessions,
  getScenarios,
  getUsers,
  saveGame,
  upsert,
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
    // Só metadados: o áudio (data URL) é pesado e é buscado sob demanda.
    music: getMusic().map((t) => ({ id: t.id, name: t.name, duration: t.duration })),
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

// --- Música compartilhada ---

/** Começa a tocar uma faixa (posição derivada de startedAt = agora). */
export async function playTrack(trackId: string): Promise<void> {
  const exists = getMusic().some((t) => t.id === trackId);
  if (!exists) return;
  await mutate((g) => {
    const loop = g.nowPlaying?.loop ?? true;
    g.nowPlaying = { trackId, startedAt: Date.now(), loop };
  });
}

/** Liga/desliga o loop sem reiniciar a faixa (mantém startedAt). */
export async function setMusicLoop(loop: boolean): Promise<void> {
  await mutate((g) => {
    if (g.nowPlaying) g.nowPlaying = { ...g.nowPlaying, loop };
  });
}

/** Para a música. */
export async function stopMusic(): Promise<void> {
  await mutate((g) => {
    g.nowPlaying = null;
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
export const TURN_DURATION_MS = 30 * 1000;

/** Reinicia o cronômetro do turno (chamado a cada interação do jogador). */
export async function bumpTurnTimer(): Promise<void> {
  await mutate((g) => {
    if (g.battle) g.battle.turnEndsAt = Date.now() + TURN_DURATION_MS;
  });
}

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

/** Ids de armas que o token possui (ficha do jogador ou NPC do catálogo). */
function tokenWeaponIds(token: Token): string[] {
  if (token.characterId) {
    const ch = getCharacters().find((c) => c.id === token.characterId);
    return ch?.items.map((s) => s.id) ?? [];
  }
  if (token.npcId) {
    return getNpcs().find((n) => n.id === token.npcId)?.weapons ?? [];
  }
  return [];
}

/** Munição inicial: capacidade cheia de cada arma do token que tenha maxAmmo. */
function initialAmmo(token: Token): Record<string, number> {
  const ammo: Record<string, number> = {};
  const items = getItems();
  for (const id of tokenWeaponIds(token)) {
    const w = items.find((i) => i.id === id);
    if (w?.category === "weapon" && w.maxAmmo) ammo[id] = w.maxAmmo;
  }
  return ammo;
}

/** Regenera as cargas de distorção do ator atual (jogador ou inimigo). */
function regenCurrentActor(b: BattleState): void {
  const entry = b.initiative[b.turnIndex];
  if (!entry) return;
  const tok = b.tokens.find((t) => t.id === entry.tokenId);
  if (!tok || (tok.kind !== "player" && tok.kind !== "enemy")) return;
  const lvl = tokenLevel(tok);
  tok.charges = Math.min(maxCharges(lvl), (tok.charges ?? 0) + chargeRegen(lvl));
  // Novo turno do ator: a ação principal volta a ficar disponível.
  tok.actedThisTurn = false;
}

export async function startBattle(grid: number, tokens: Token[]): Promise<void> {
  const size = Math.max(4, Math.min(10, Math.round(grid)));
  // Jogadores e inimigos começam com as cargas cheias do seu nível e munição cheia.
  for (const t of tokens) {
    if (t.kind === "player" || t.kind === "enemy") {
      t.charges = maxCharges(tokenLevel(t));
      t.ammo = initialAmmo(t);
    }
  }
  await mutate((g) => {
    const battle: BattleState = {
      grid: size,
      tokens,
      initiative: [],
      turnIndex: 0,
      turnSeq: 0,
      turnEndsAt: 0,
      history: [],
      log: ["Batalha iniciada."],
    };
    g.battle = battle;
    g.mode = "battle";
  });
}

export async function endBattle(): Promise<void> {
  // Persiste o HP/estado finais dos jogadores de volta nas fichas.
  const battle = getGame().battle;
  if (battle) {
    for (const tok of battle.tokens) {
      if (tok.kind !== "player" || !tok.characterId) continue;
      const ch = getCharacters().find((c) => c.id === tok.characterId);
      if (!ch) continue;
      await upsert("characters", {
        ...ch,
        hp: tok.hp ?? ch.hp,
        state: tok.state ?? ch.state,
      });
    }
  }
  // Volta ao cenário mas MANTÉM a batalha (pausada), para poder resumir/revisitar.
  await mutate((g) => {
    g.mode = "scenario";
  });
}

/** Resume a batalha pausada (volta ao modo batalha). */
export async function resumeBattle(): Promise<void> {
  await mutate((g) => {
    if (g.battle) g.mode = "battle";
  });
}

/** GM adiciona um inimigo (do catálogo de NPCs) numa casa vazia, em combate. */
export async function addEnemyToken(
  npcId: string,
  pos: { x: number; y: number },
): Promise<void> {
  const npc = getNpcs().find((n) => n.id === npcId);
  if (!npc) return;
  await mutate((g) => {
    const b = g.battle;
    if (!b) return;
    if (b.tokens.some((t) => t.pos.x === pos.x && t.pos.y === pos.y)) return; // ocupada
    const keep = b.initiative[b.turnIndex]?.tokenId;
    const tok: Token = {
      id: `tok_${Math.random().toString(36).slice(2, 9)}`,
      kind: "enemy",
      pos: { ...pos },
      label: npc.name,
      hp: npc.hp,
      maxHp: npc.hp,
      state: "Disposto",
      npcId: npc.id,
      neutral: npc.hostile === false,
    };
    tok.charges = maxCharges(npc.level ?? 0);
    tok.ammo = initialAmmo(tok);
    b.tokens.push(tok);
    const value = Math.floor(Math.random() * 100) + 1;
    b.initiative.push({ tokenId: tok.id, value, label: npc.name });
    b.initiative.sort((a, c) => c.value - a.value);
    const idx = b.initiative.findIndex((i) => i.tokenId === keep);
    if (idx >= 0) b.turnIndex = idx;
    pushLog(g, `GM adicionou ${npc.name} (iniciativa ${value}).`);
  });
}

/**
 * Insere um token na ordem de iniciativa (se ainda não estiver), reordena e
 * mantém o turno apontando para o ator atual. Retorna true se inseriu.
 */
export async function addInitiativeEntry(
  tokenId: string,
  value: number,
  label: string,
): Promise<boolean> {
  let ok = false;
  await mutate((g) => {
    const b = g.battle;
    if (!b) return;
    if (b.initiative.some((i) => i.tokenId === tokenId)) return;
    const keep = b.initiative[b.turnIndex]?.tokenId;
    b.initiative.push({ tokenId, value, label });
    b.initiative.sort((a, c) => c.value - a.value);
    const idx = b.initiative.findIndex((i) => i.tokenId === keep);
    if (idx >= 0) b.turnIndex = idx;
    ok = true;
  });
  return ok;
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
    g.battle.turnSeq = (g.battle.turnSeq ?? 0) + 1;
    g.battle.turnEndsAt = Date.now() + TURN_DURATION_MS;
    regenCurrentActor(g.battle);
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
    // Novo turno exibido (avançar ou retroceder): incrementa o id monotônico para
    // o cliente reiniciar o fluxo. Mortes/remoções no meio do turno NÃO mexem aqui.
    b.turnSeq = (b.turnSeq ?? 0) + 1;
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

/**
 * Tira tokens da ordem de iniciativa SEM removê-los do mapa (ex.: mortos viram
 * "corpos" que continuam ocupando a casa, mas não jogam mais).
 */
export async function dropFromInitiative(ids: string[], keepActorId: string): Promise<void> {
  if (ids.length === 0) return;
  await mutate((g) => {
    const b = g.battle;
    if (!b) return;
    const remove = new Set(ids);
    b.initiative = b.initiative.filter((i) => !remove.has(i.tokenId));
    const idx = b.initiative.findIndex((i) => i.tokenId === keepActorId);
    if (idx >= 0) b.turnIndex = idx;
    else if (b.turnIndex >= b.initiative.length) b.turnIndex = 0;
  });
}

/** Mantém só as últimas N ações no histórico de combate (não guarda o resto). */
export const MAX_LOG = 20;
function pushLog(g: GameState, line: string): void {
  if (!g.battle) return;
  g.battle.log.push(line);
  if (g.battle.log.length > MAX_LOG) {
    g.battle.log = g.battle.log.slice(-MAX_LOG);
  }
}

export async function appendLog(line: string): Promise<void> {
  await mutate((g) => pushLog(g, line));
}

export async function setLastRoll(roll: Roll): Promise<void> {
  await mutate((g) => {
    g.lastRoll = roll;
  });
}
