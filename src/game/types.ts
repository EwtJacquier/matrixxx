// Tipos compartilhados entre servidor e cliente.

export type Role = "gm" | "player";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: number;
}

/** Estados de personagem em ordem de gravidade (índice = severidade). */
export const STATES = [
  "Disposto",
  "Machucado",
  "Incapacitado",
  "Perto da Morte",
  "Morto",
] as const;
export type CharState = (typeof STATES)[number];

/** HP máximo por nível (lvl 0 a 3). */
export const HP_BY_LEVEL = [10, 20, 30, 40] as const;

/** Slots de roles/hacks por nível (lvl 0 a 3). */
export const SLOTS_BY_LEVEL = [0, 2, 3, 4] as const;

export interface Profession {
  id: string;
  name: string;
  hack_found: boolean;
  description: string;
}

export type ItemCategory = "weapon" | "accessory" | "item";

export interface CatalogItem {
  id: string;
  category: ItemCategory;
  name: string;
  /** Fórmula de dado+fixo, ex.: "2d6+2" (armas/items usáveis). */
  damage?: string;
  /** Alcance em casas (distância de Manhattan). Arma corpo a corpo = 1. */
  range?: number;
  /** Raio de área de efeito a partir do alvo (0/ausente = só o alvo). */
  area?: number;
  /** Bônus de defesa (acessório): ignora X de dano. */
  dfBonus?: number;
  /** Bônus de movimento (acessório). */
  mvBonus?: number;
  description?: string;
}

export interface Hack {
  id: string;
  name: string;
  description: string;
}

export interface Disguise {
  id: string;
  name: string;
  description: string;
}

/** Inimigo/NPC cadastrável pelo GM, usado para gerar tokens na batalha. */
export interface Npc {
  id: string;
  name: string;
  hp: number;
  damage?: string; // fórmula dado+fixo (ex.: 1d8+1)
  /** nível (0-3): define as cargas de distorção como nos jogadores. */
  level?: 0 | 1 | 2 | 3;
  /** false = NPC neutro (branco); true/ausente = inimigo (vermelho). */
  hostile?: boolean;
  description?: string;
  picture?: string; // data URL (com crop)
}

/** Objeto de cenário cadastrável pelo GM. A regra é fixa (ver game/objects.ts). */
export interface GameObject {
  id: string;
  name: string;
  /** id de uma regra fixa em OBJECT_RULES. */
  rule: import("./objects").ObjectRuleId;
  /** item concedido ao passar por cima (apenas regra "item"). */
  itemId?: string;
  /** se true, some do mapa após ser usado uma vez (ex.: a mesa). */
  destroyOnUse?: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  image: string; // data URL ou caminho
  distortion: number; // 0..10
}

export interface Character {
  id: string;
  userId: string;
  name: string;
  level: 0 | 1 | 2 | 3;
  hp: number;
  maxHp: number;
  mv: number; // base 2 + acessório
  df: number; // base 0 + acessório
  picture: string; // data URL (com crop)
  costume: string;
  roles: string[]; // ids de Profession
  hacks: string[]; // ids de Hack
  items: string[]; // ids de CatalogItem (até 10)
  state: CharState;
}

export type TokenKind = "player" | "enemy" | "object";

export interface Token {
  id: string;
  kind: TokenKind;
  pos: { x: number; y: number };
  label: string;
  // player/enemy
  hp?: number;
  maxHp?: number;
  state?: CharState;
  charges?: number; // cargas de distorção disponíveis (jogadores)
  neutral?: boolean; // inimigo neutro (NPC, branco) em vez de hostil (vermelho)
  characterId?: string; // quando kind=player
  npcId?: string; // quando kind=enemy e veio do catálogo de NPCs
  // object
  rule?: import("./objects").ObjectRuleId; // regra fixa do objeto
  objectId?: string; // ref ao objeto do catálogo
  itemId?: string; // item concedido (regra "item")
  destroyOnUse?: boolean; // some do mapa após uso único
}

export interface Initiative {
  tokenId: string;
  value: number; // 0..100
  label: string;
}

export type ActionKind = "attack" | "useItem" | "special";

export interface ConfirmedAction {
  tokenId: string;
  kind: ActionKind;
  targetId?: string;
  detail?: string;
  /** id do token-objeto quando a ação especial usa um objeto (ex.: chutar mesa). */
  objectId?: string;
  /** cargas de distorção gastas no ataque (+dano). */
  attackCharges?: number;
  rollId?: string;
}

/** Modelo de batalha salvo: grid + tokens posicionados, para reimportar. */
export interface BattleTemplate {
  id: string;
  name: string;
  grid: number;
  tokens: Token[];
}

export interface BattleState {
  grid: number; // 4..7
  tokens: Token[];
  initiative: Initiative[]; // ordenado desc por value
  turnIndex: number; // índice na ordem de iniciativa
  /** timestamp (ms) em que o turno atual estoura e pula automático. */
  turnEndsAt: number;
  /** snapshot por turno para avançar/retroceder. */
  history: BattleSnapshot[];
  log: string[];
}

/** Evento de dano para animar a perda de HP sobre o token. */
export interface DamageEvent {
  tokenId: string;
  amount: number;
  /** posição do alvo no momento do dano (popup aparece mesmo se o token morrer). */
  pos: { x: number; y: number };
  /** modificadores de objeto aplicados, ex.: "DEF +1", "ATK -1". */
  notes?: string[];
}

export interface BattleSnapshot {
  turnIndex: number;
  tokens: Token[];
  distortion: number;
}

export interface Roll {
  id: string;
  formula: string; // ex.: "1d100", "2d6+2"
  flat: number;
  results: number[];
  total: number;
  author: string;
  reason: string;
  at: number;
}

export type GameMode = "scenario" | "battle";

export interface GameState {
  mode: GameMode;
  scenarioId: string | null;
  distortion: number; // 0..10 (espelha o do cenário ativo, ajustável em tempo real)
  battle: BattleState | null;
  lastRoll: Roll | null;
}

/** Estado público enviado aos clientes (sem hashes de senha). */
export interface PublicState {
  game: GameState;
  scenarios: Scenario[];
  professions: Profession[];
  items: CatalogItem[];
  hacks: Hack[];
  disguises: Disguise[];
  npcs: Npc[];
  objects: GameObject[];
  battleTemplates: BattleTemplate[];
  characters: Character[];
  players: { id: string; email: string; role: Role }[];
}
