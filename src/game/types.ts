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

export type ProfessionKind = "combat" | "rp";

export interface Profession {
  id: string;
  name: string;
  /** combate (dá vantagens em batalha) ou RP (narrativa; só marcado no card). */
  kind: ProfessionKind;
  /** profissão com hack disponível na matrix (flag evidente na lista). */
  hack_found: boolean;
  description: string;
  // --- Bônus de combate (só kind === "combat") ---
  /** +movimento. */
  mvBonus?: number;
  /** +defesa (ignora X de dano). */
  dfBonus?: number;
  /** +dano fixo, aplicado só ao tipo de arma `dmgType`. */
  dmgBonus?: number;
  /** tipo de arma que recebe o +dano (default corpo a corpo). */
  dmgType?: WeaponType;
  /** +HP máximo. */
  hpBonus?: number;
}

export type ItemCategory = "weapon" | "accessory" | "item";

/** Tipo de arma: corpo a corpo ou arma de fogo. Mãos livres = corpo a corpo. */
export type WeaponType = "melee" | "firearm";

export interface CatalogItem {
  id: string;
  category: ItemCategory;
  name: string;
  /** Tipo da arma (category weapon). Ausente = inferido pelo alcance. */
  weaponType?: WeaponType;
  /** Fórmula de dado+fixo, ex.: "2d6+2" (armas/items usáveis). */
  damage?: string;
  /** Alcance MÁXIMO em casas (distância de Manhattan). Arma corpo a corpo = 1. */
  range?: number;
  /** Alcance MÍNIMO (ausente/1 = pode atacar coladinho). Ex.: fuzil 3-4. */
  minRange?: number;
  /** Raio de área de efeito a partir do alvo (0/ausente = só o alvo). */
  area?: number;
  /** Capacidade de munição de uma arma (usos antes de recarregar). 0/ausente = ilimitado. */
  maxAmmo?: number;
  /** Bônus de defesa (acessório): ignora X de dano. */
  dfBonus?: number;
  /** Bônus de movimento (acessório). */
  mvBonus?: number;
  /** Consumível (category item): pontos de vida restaurados ao usar. */
  heal?: number;
  /** Consumível (category item): melhora o estado em N passos (rumo a Disposto). */
  improveState?: number;
  /** Consumível (category item): munição recarregada na arma escolhida ao usar. */
  ammo?: number;
  description?: string;
}

/** Entrada de inventário com quantidade. */
export interface ItemStack {
  id: string;
  qty: number;
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
  /** 1 a 3 armas do catálogo (ids de CatalogItem categoria weapon). */
  weapons?: string[];
  damage?: string; // legado: fórmula fixa, usada se não houver armas
  /** nível (0-3): define as cargas de distorção como nos jogadores. */
  level?: 0 | 1 | 2 | 3;
  /** false = NPC neutro (branco); true/ausente = inimigo (vermelho). */
  hostile?: boolean;
  description?: string;
  picture?: string; // data URL (com crop). Vem vazio no PublicState; buscado sob demanda.
  pictureVer?: number; // versão da imagem (invalida o cache do cliente ao trocar).
}

/** Objeto de cenário cadastrável pelo GM. A regra é fixa (ver game/objects.ts). */
export interface GameObject {
  id: string;
  name: string;
  /** id de uma regra fixa em OBJECT_RULES. */
  rule: import("./objects").ObjectRuleId;
  /** valor do modificador (bonus/disadvantage); ausente = default da regra. */
  value?: number;
  /** HP do objeto; se definido (>0), pode ser atacado e destruído. */
  hp?: number;
  /** item concedido ao passar por cima (apenas regra "item"). */
  itemId?: string;
  /** quantidade de munição recarregada (regra "reload"). */
  reloadAmount?: number;
  /** itens concedidos ao abrir (regra "chest"). */
  grant?: ItemStack[];
  /** limite de usos da ação (regra action/reload/chest). Ausente = ilimitado. */
  maxUses?: number;
  /** se true, some do mapa após ser usado uma vez (ex.: a mesa). */
  destroyOnUse?: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  image: string; // data URL ou caminho. Vem vazio no PublicState; buscado sob demanda.
  imageVer?: number; // versão da imagem (invalida o cache do cliente ao trocar).
  distortion: number; // 0..10
}

export interface Character {
  id: string;
  userId: string;
  name: string;
  level: 0 | 1 | 2 | 3;
  hp: number;
  maxHp: number;
  mv: number; // base 2 + acessório + profissões de combate
  df: number; // base 0 + acessório + profissões de combate
  picture: string; // data URL (com crop). Vem vazio no PublicState; buscado sob demanda.
  pictureVer?: number; // versão da imagem (invalida o cache do cliente ao trocar).
  costume: string;
  roles: string[]; // ids de Profession (combate + RP; máx 2 de cada)
  items: ItemStack[]; // inventário com quantidades (até 10 tipos)
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
  actedThisTurn?: boolean; // já usou a ação principal neste turno
  ammo?: Record<string, number>; // munição restante por arma (id -> restante)
  neutral?: boolean; // inimigo neutro (NPC, branco) em vez de hostil (vermelho)
  characterId?: string; // quando kind=player
  npcId?: string; // quando kind=enemy e veio do catálogo de NPCs
  // object (hp/maxHp acima são reutilizados: objeto com hp pode ser atacado)
  rule?: import("./objects").ObjectRuleId; // regra fixa do objeto
  value?: number; // valor do modificador (override do default da regra)
  objectId?: string; // ref ao objeto do catálogo
  itemId?: string; // item concedido (regra "item")
  reloadAmount?: number; // munição recarregada (regra "reload")
  grant?: ItemStack[]; // itens do baú (regra "chest")
  usesLeft?: number; // usos restantes da ação (regra action/reload/chest)
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
  /** posição encenada de onde a ação é resolvida (sem mover o token de fato). */
  fromPos?: { x: number; y: number };
  targetId?: string;
  detail?: string;
  /** id do token-objeto quando a ação especial usa um objeto (ex.: chutar mesa). */
  objectId?: string;
  /** cargas de distorção gastas no ataque (+dano). */
  attackCharges?: number;
  /** consumível usado (kind=useItem): id do item; weaponId se for recarga. */
  useItemId?: string;
  reloadWeaponId?: string;
  rollId?: string;
  /** se o ator se moveu antes de agir: posição final a confirmar junto da ação. */
  commitPos?: { x: number; y: number };
  /** cargas de distorção alocadas ao movimento (para o commit acima). */
  moveCharges?: number;
  /** encerra o turno atomicamente após a ação (evita corrida de eventos). */
  endTurn?: boolean;
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
  /** id monotônico do turno atual; muda só em transição real de turno (avançar/
   * retroceder/iniciar ordem). Usado pelo cliente para reiniciar o fluxo sem
   * confundir com mudanças de turnIndex causadas por mortes/remoções no meio do turno. */
  turnSeq: number;
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

/** Faixa de música (MP3) cadastrada pelo GM. `src` é um data URL (audio/mpeg). */
export interface MusicTrack {
  id: string;
  name: string;
  duration: number; // segundos
  src: string; // data URL — NÃO vai no PublicState (pesado); buscado sob demanda
}

/** Metadados de música transmitidos a todos (sem o áudio pesado). */
export type MusicMeta = Omit<MusicTrack, "src">;

/** Música tocando agora, sincronizada pelo relógio do servidor. */
export interface NowPlaying {
  trackId: string;
  /** epoch (ms) em que a faixa começou — a posição atual deriva disto. */
  startedAt: number;
  loop: boolean;
}

export interface GameState {
  mode: GameMode;
  scenarioId: string | null;
  distortion: number; // 0..10 (espelha o do cenário ativo, ajustável em tempo real)
  battle: BattleState | null;
  lastRoll: Roll | null;
  /** música compartilhada tocando na mesa (null = nenhuma). */
  nowPlaying: NowPlaying | null;
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
  /** catálogo de músicas — só metadados (o áudio é buscado sob demanda). */
  music: MusicMeta[];
  players: { id: string; email: string; role: Role }[];
}
