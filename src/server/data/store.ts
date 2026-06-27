// Camada de persistência em JSON com fila de escrita serializada por arquivo,
// para evitar corrupção em escritas concorrentes.

import { promises as fs } from "fs";
import path from "path";
import type {
  BattleTemplate,
  Character,
  Disguise,
  GameObject,
  GameState,
  Hack,
  CatalogItem,
  Npc,
  Profession,
  Scenario,
  User,
} from "@/game/types";
import {
  BATTLE_TEMPLATES,
  DISGUISES,
  HACKS,
  ITEMS,
  NPCS,
  OBJECTS,
  PROFESSIONS,
  SCENARIOS,
} from "./seeds";

const DATA_DIR = path.join(process.cwd(), "data");

type Collections = {
  users: User[];
  characters: Character[];
  scenarios: Scenario[];
  professions: Profession[];
  items: CatalogItem[];
  hacks: Hack[];
  disguises: Disguise[];
  npcs: Npc[];
  objects: GameObject[];
  battleTemplates: BattleTemplate[];
  game: GameState;
};

const DEFAULT_GAME: GameState = {
  mode: "scenario",
  scenarioId: SCENARIOS[0]?.id ?? null,
  distortion: 0,
  battle: null,
  lastRoll: null,
};

const DEFAULTS: Collections = {
  users: [],
  characters: [],
  scenarios: SCENARIOS,
  professions: PROFESSIONS,
  items: ITEMS,
  hacks: HACKS,
  disguises: DISGUISES,
  npcs: NPCS,
  objects: OBJECTS,
  battleTemplates: BATTLE_TEMPLATES,
  game: DEFAULT_GAME,
};

// Fila de escrita por arquivo: cada save encadeia na promise anterior.
const writeQueues = new Map<string, Promise<void>>();

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function filePath(name: keyof Collections): string {
  return path.join(DATA_DIR, `${name}.json`);
}

async function readCollection<K extends keyof Collections>(
  name: K,
): Promise<Collections[K]> {
  try {
    const raw = await fs.readFile(filePath(name), "utf8");
    return JSON.parse(raw) as Collections[K];
  } catch {
    return DEFAULTS[name];
  }
}

function writeCollection<K extends keyof Collections>(
  name: K,
  value: Collections[K],
): Promise<void> {
  const key = String(name);
  const prev = writeQueues.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      await ensureDir();
      const tmp = filePath(name) + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
      await fs.rename(tmp, filePath(name));
    });
  writeQueues.set(key, next);
  return next;
}

// Cache em memória — fonte de verdade em runtime, persistida em JSON.
let cache: Collections | null = null;

export async function initStore(): Promise<void> {
  if (cache) return;
  await ensureDir();
  const [
    users,
    characters,
    scenarios,
    professions,
    items,
    hacks,
    disguises,
    npcs,
    objects,
    battleTemplates,
    game,
  ] = await Promise.all([
    readCollection("users"),
    readCollection("characters"),
    readCollection("scenarios"),
    readCollection("professions"),
    readCollection("items"),
    readCollection("hacks"),
    readCollection("disguises"),
    readCollection("npcs"),
    readCollection("objects"),
    readCollection("battleTemplates"),
    readCollection("game"),
  ]);
  cache = {
    users,
    characters,
    scenarios,
    professions,
    items,
    hacks,
    disguises,
    npcs,
    objects,
    battleTemplates,
    game,
  };
  // Garante que os arquivos de seed existam no disco no primeiro boot.
  await Promise.all([
    persist("scenarios"),
    persist("professions"),
    persist("items"),
    persist("hacks"),
    persist("disguises"),
    persist("npcs"),
    persist("objects"),
    persist("battleTemplates"),
    persist("game"),
  ]);
}

function db(): Collections {
  if (!cache) throw new Error("Store não inicializado. Chame initStore() antes.");
  return cache;
}

async function persist<K extends keyof Collections>(name: K): Promise<void> {
  await writeCollection(name, db()[name]);
}

// --- Acessores ---

export function getUsers(): User[] {
  return db().users;
}

export async function addUser(user: User): Promise<void> {
  db().users.push(user);
  await persist("users");
}

/**
 * Relê users.json do disco para o cache em memória.
 *
 * No `next dev`, os route handlers (signup/login) e o servidor custom (socket)
 * rodam em bundles separados, cada um com sua própria instância deste módulo —
 * logo, caches de usuários distintos. As contas são criadas pelos route handlers
 * e gravadas em disco; o lado do socket precisa reler para enxergá-las. Como o
 * arquivo só é escrito pelas rotas, reler é seguro e barato.
 */
export async function refreshUsers(): Promise<User[]> {
  const users = await readCollection("users");
  if (cache) cache.users = users;
  return users;
}

export function getScenarios(): Scenario[] {
  return db().scenarios;
}

export function getProfessions(): Profession[] {
  return db().professions;
}

export function getItems(): CatalogItem[] {
  return db().items;
}

export function getHacks(): Hack[] {
  return db().hacks;
}

export function getDisguises(): Disguise[] {
  return db().disguises;
}

export function getNpcs(): Npc[] {
  return db().npcs;
}

export function getObjects(): GameObject[] {
  return db().objects;
}

export function getBattleTemplates(): BattleTemplate[] {
  return db().battleTemplates;
}

export function getCharacters(): Character[] {
  return db().characters;
}

export function getGame(): GameState {
  return db().game;
}

// CRUD genérico para coleções administráveis pelo GM.
type CrudCollection =
  | "scenarios"
  | "professions"
  | "items"
  | "hacks"
  | "disguises"
  | "npcs"
  | "objects"
  | "battleTemplates"
  | "characters";

export async function upsert<T extends { id: string }>(
  name: CrudCollection,
  entity: T,
): Promise<void> {
  const arr = db()[name] as unknown as T[];
  const idx = arr.findIndex((e) => e.id === entity.id);
  if (idx >= 0) arr[idx] = entity;
  else arr.push(entity);
  await persist(name);
}

export async function remove(name: CrudCollection, id: string): Promise<void> {
  const arr = db()[name] as unknown as { id: string }[];
  const idx = arr.findIndex((e) => e.id === id);
  if (idx >= 0) {
    arr.splice(idx, 1);
    await persist(name);
  }
}

export async function saveGame(game: GameState): Promise<void> {
  db().game = game;
  await persist("game");
}
