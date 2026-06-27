// Regras FIXAS de objetos de cenário. Cada objeto tem exatamente uma regra,
// escolhida desta lista — nada de valores/efeitos livres. Compartilhado entre
// cliente e servidor para que a aplicação e a exibição fiquem idênticas.

import type { Token } from "./types";

export type ObjectRuleId =
  | "cobertura"
  | "reforco"
  | "atrapalho"
  | "chute"
  | "item"
  | "reload"
  | "chest";

export type ObjectRuleKind =
  | "bonus"
  | "disadvantage"
  | "action"
  | "pickup"
  | "reload"
  | "chest";

export interface ObjectRule {
  id: ObjectRuleId;
  name: string; // nome padrão sugerido
  kind: ObjectRuleKind;
  /** o que a regra afeta nos adjacentes (bonus/disadvantage). */
  target: "attack" | "defense" | null;
  value: number; // sempre fixo
  /** rótulo curto mostrado no token e no popup. */
  badge: string;
  description: string;
  damage?: string; // ação (ex.: chute)
}

/** Regras acionadas como "ação especial" quando adjacente. */
export const ACTION_RULE_KINDS: ObjectRuleKind[] = ["action", "reload", "chest"];

export function isActionRule(kind: ObjectRuleKind | undefined): boolean {
  return !!kind && ACTION_RULE_KINDS.includes(kind);
}

export const OBJECT_RULES: Record<ObjectRuleId, ObjectRule> = {
  cobertura: {
    id: "cobertura",
    name: "Cobertura",
    kind: "bonus",
    target: "defense",
    value: 3,
    badge: "DEF",
    description: "Adjacentes recebem defesa extra (sofrem menos dano).",
  },
  reforco: {
    id: "reforco",
    name: "Reforço",
    kind: "bonus",
    target: "attack",
    value: 3,
    badge: "ATK",
    description: "Adjacentes causam dano extra.",
  },
  atrapalho: {
    id: "atrapalho",
    name: "Terreno Ruim",
    kind: "disadvantage",
    target: "attack",
    value: 3,
    badge: "ATK",
    description: "Adjacentes causam menos dano.",
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
  reload: {
    id: "reload",
    name: "Caixa de Munição",
    kind: "reload",
    target: null,
    value: 0,
    badge: "RECARGA",
    description: "Adjacente: recarrega a munição da arma escolhida.",
  },
  chest: {
    id: "chest",
    name: "Baú",
    kind: "chest",
    target: null,
    value: 0,
    badge: "BAÚ",
    description: "Adjacente: abra para receber os itens guardados.",
  },
};

export const OBJECT_RULE_LIST = Object.values(OBJECT_RULES);

export function ruleOf(token: Token): ObjectRule | null {
  if (token.kind !== "object" || !token.rule) return null;
  return OBJECT_RULES[token.rule] ?? null;
}

/** Valor efetivo do objeto: override por token, ou o default da regra. */
export function effectiveValue(token: Token): number {
  const rule = ruleOf(token);
  if (!rule) return 0;
  return token.value ?? rule.value;
}

/** Badge exibido no token/painel, já com o valor efetivo. */
export function objectBadge(token: Token): string {
  const rule = ruleOf(token);
  if (!rule) return "";
  const v = effectiveValue(token);
  if (rule.target === "attack") return `ATK ${rule.kind === "bonus" ? "+" : "-"}${v}`;
  if (rule.target === "defense") return `DEF +${v}`;
  return rule.badge; // action / pickup / reload / chest
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
    const v = effectiveValue(o);
    const signed = rule.kind === "bonus" ? v : -v;
    if (rule.target === "attack") attack += signed;
    else if (rule.target === "defense") defense += signed;
    badges.push({ badge: objectBadge(o), kind: rule.kind });
  }
  return { attack, defense, badges };
}
