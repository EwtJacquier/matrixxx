// Parser e resolvedor de fórmulas de dado, ex.: "1d100", "2d6+2", "1d8-1".
// A rolagem é resolvida no SERVIDOR (autoridade) e transmitida a todos.

import type { Roll } from "./types";

export interface ParsedFormula {
  count: number;
  sides: number;
  flat: number;
}

const FORMULA_RE = /^\s*(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i;

export function parseFormula(formula: string): ParsedFormula {
  const m = FORMULA_RE.exec(formula);
  if (!m) {
    throw new Error(`Fórmula de dado inválida: "${formula}"`);
  }
  const count = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const flat = m[3] ? parseInt(m[3].replace(/\s+/g, ""), 10) : 0;
  if (count < 1 || count > 20) throw new Error("Quantidade de dados fora do intervalo (1..20).");
  if (sides < 2 || sides > 100) throw new Error("Faces fora do intervalo (2..100).");
  return { count, sides, flat };
}

function d(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

let seq = 0;
function rollId(): string {
  seq = (seq + 1) % Number.MAX_SAFE_INTEGER;
  return `roll_${Date.now().toString(36)}_${seq}`;
}

export function roll(formula: string, author: string, reason: string): Roll {
  const { count, sides, flat } = parseFormula(formula);
  const results: number[] = [];
  for (let i = 0; i < count; i++) results.push(d(sides));
  const total = results.reduce((a, b) => a + b, 0) + flat;
  return {
    id: rollId(),
    formula,
    flat,
    results,
    total,
    author,
    reason,
    at: Date.now(),
  };
}

/** Notação compacta para o dice-box (ex.: "2d6"), ignora o modificador fixo. */
export function diceBoxNotation(formula: string): string {
  const { count, sides } = parseFormula(formula);
  return `${count}d${sides}`;
}
