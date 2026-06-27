// Regras FIXAS de objetos de cenário. Cada objeto tem exatamente uma regra,
// escolhida desta lista — nada de valores/efeitos livres. Compartilhado entre
// cliente e servidor para que a aplicação e a exibição fiquem idênticas.

import type { Token } from "./types";

export type ObjectRuleId = "cobertura" | "reforco" | "atrapalho" | "chute" | "item";

export interface ObjectRule {
  id: ObjectRuleId;
  name: string; // nome padrão sugerido
  kind: "bonus" | "disadvantage" | "action" | "pickup";
  /** o que a regra afeta nos adjacentes (bonus/disadvantage). */
  target: "attack" | "defense" | null;
  value: number; // sempre fixo
  /** rótulo curto mostrado no token e no popup. */
  badge: string;
  description: string;
  damage?: string; // ação (ex.: chute)
}

export const OBJECT_RULES: Record<ObjectRuleId, ObjectRule> = {
  cobertura: {
    id: "cobertura",
    name: "Cobertura",
    kind: "bonus",
    target: "defense",
    value: 1,
    badge: "DEF +1",
    description: "Adjacentes recebem +1 de defesa (sofrem -1 de dano).",
  },
  reforco: {
    id: "reforco",
    name: "Reforço",
    kind: "bonus",
    target: "attack",
    value: 1,
    badge: "ATK +1",
    description: "Adjacentes causam +1 de dano.",
  },
  atrapalho: {
    id: "atrapalho",
    name: "Terreno Ruim",
    kind: "disadvantage",
    target: "attack",
    value: 1,
    badge: "ATK -1",
    description: "Adjacentes causam -1 de dano.",
  },
  chute: {
    id: "chute",
    name: "Objeto Pesado",
    kind: "action",
    target: null,
    value: 0,
    badge: "AÇÃO",
    damage: "2d6",
    description: "Adjacente: chute o objeto em linha reta no alvo (2d6).",
  },
  item: {
    id: "item",
    name: "Suprimento",
    kind: "pickup",
    target: null,
    value: 0,
    badge: "ITEM",
    description: "Passe por cima para pegar (não gasta ação).",
  },
};

export const OBJECT_RULE_LIST = Object.values(OBJECT_RULES);

export function ruleOf(token: Token): ObjectRule | null {
  if (token.kind !== "object" || !token.rule) return null;
  return OBJECT_RULES[token.rule] ?? null;
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export interface AdjacencyMods {
  attack: number;
  defense: number;
  badges: { badge: string; kind: ObjectRule["kind"] }[];
}

/** Modificadores que um token recebe por estar adjacente a objetos. */
export function adjacencyMods(token: Token, tokens: Token[]): AdjacencyMods {
  let attack = 0;
  let defense = 0;
  const badges: AdjacencyMods["badges"] = [];
  for (const o of tokens) {
    if (o.kind !== "object") continue;
    if (manhattan(token.pos, o.pos) !== 1) continue;
    const rule = ruleOf(o);
    if (!rule || !rule.target) continue;
    const signed = rule.kind === "bonus" ? rule.value : -rule.value;
    if (rule.target === "attack") attack += signed;
    else if (rule.target === "defense") defense += signed;
    badges.push({ badge: rule.badge, kind: rule.kind });
  }
  return { attack, defense, badges };
}
