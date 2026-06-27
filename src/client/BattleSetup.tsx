"use client";

import { useState } from "react";
import { useGame } from "./GameProvider";
import { OBJECT_RULES } from "@/game/objects";
import type { BattleTemplate, GameObject, Npc, Token } from "@/game/types";
import styles from "./BattleSetup.module.css";

function uid(p: string) {
  return `${p}_${Math.random().toString(36).slice(2, 9)}`;
}

export function BattleSetup({ onClose }: { onClose: () => void }) {
  const { state, emit } = useGame();
  const [grid, setGrid] = useState(5);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");

  if (!state) return null;

  // Importa um modelo salvo: carrega grid e tokens (com novos ids).
  function importTemplate(tpl: BattleTemplate) {
    setGrid(tpl.grid);
    setTokens(tpl.tokens.map((t) => ({ ...t, id: uid("tok") })));
    setSelected(null);
  }

  // Salva a montagem atual como um modelo reutilizável.
  function saveTemplate() {
    const name = templateName.trim();
    if (!name || tokens.length === 0) return;
    const tpl: BattleTemplate = {
      id: uid("tpl"),
      name,
      grid,
      tokens: JSON.parse(JSON.stringify(tokens)),
    };
    emit("catalog:upsert", { kind: "battleTemplates", entity: tpl });
    setTemplateName("");
  }

  // Primeira casa livre, varrendo a partir de um canto (evita 2 tokens no mesmo lugar).
  function freeCell(used: Token[], fromBottom = false): { x: number; y: number } {
    const taken = new Set(used.map((t) => `${t.pos.x},${t.pos.y}`));
    const ys = fromBottom
      ? Array.from({ length: grid }, (_, i) => grid - 1 - i)
      : Array.from({ length: grid }, (_, i) => i);
    for (const y of ys) {
      for (let x = 0; x < grid; x++) {
        if (!taken.has(`${x},${y}`)) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  function addPlayerTokens() {
    setTokens((t) => {
      const existing = new Set(t.filter((x) => x.kind === "player").map((x) => x.characterId));
      const acc = [...t];
      for (const c of state!.characters) {
        if (existing.has(c.id)) continue;
        acc.push({
          id: uid("tok"),
          kind: "player",
          pos: freeCell(acc),
          label: c.name || "jogador",
          hp: c.hp,
          maxHp: c.maxHp,
          state: c.state,
          characterId: c.id,
        });
      }
      return acc;
    });
  }

  function addNpc(npc: Npc) {
    setTokens((t) => [
      ...t,
      {
        id: uid("tok"),
        kind: "enemy",
        pos: freeCell(t, true),
        label: npc.name,
        hp: npc.hp,
        maxHp: npc.hp,
        state: "Disposto",
        npcId: npc.id,
        neutral: npc.hostile === false,
      },
    ]);
  }

  function addObject(obj: GameObject) {
    setTokens((t) => [
      ...t,
      {
        id: uid("tok"),
        kind: "object",
        pos: freeCell(t),
        label: obj.name,
        rule: obj.rule,
        objectId: obj.id,
        itemId: obj.itemId,
        destroyOnUse: obj.destroyOnUse,
      },
    ]);
  }

  function placeAt(x: number, y: number) {
    if (!selected) return;
    // não permite empilhar tokens
    if (tokens.some((t) => t.id !== selected && t.pos.x === x && t.pos.y === y)) return;
    setTokens((t) =>
      t.map((tok) => (tok.id === selected ? { ...tok, pos: { x, y } } : tok)),
    );
  }

  function updateToken(id: string, patch: Partial<Token>) {
    setTokens((t) => t.map((tok) => (tok.id === id ? { ...tok, ...patch } : tok)));
  }

  function removeToken(id: string) {
    setTokens((t) => t.filter((tok) => tok.id !== id));
    if (selected === id) setSelected(null);
  }

  const hasPlayer = tokens.some((t) => t.kind === "player");

  function start() {
    if (!hasPlayer) return;
    emit("gm:startBattle", { grid, tokens });
    onClose();
  }

  const cellAt = (x: number, y: number) =>
    tokens.find((t) => t.pos.x === x && t.pos.y === y);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2>Montar batalha</h2>

        <div className={styles.templates}>
          <label>
            Modelo
            <select
              defaultValue=""
              onChange={(e) => {
                const tpl = state.battleTemplates.find((t) => t.id === e.target.value);
                if (tpl) importTemplate(tpl);
                e.target.value = "";
              }}
            >
              <option value="">importar modelo…</option>
              {state.battleTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.grid}×{t.grid}, {t.tokens.length})
                </option>
              ))}
            </select>
          </label>
          <span className={styles.tplSave}>
            <input
              placeholder="nome do modelo"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <button onClick={saveTemplate} disabled={!templateName.trim() || tokens.length === 0}>
              Salvar modelo
            </button>
          </span>
        </div>

        <div className={styles.controls}>
          <label>
            Grid
            <select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
              {[4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} x {n}
                </option>
              ))}
            </select>
          </label>
          <button onClick={addPlayerTokens}>+ jogadores</button>
          <select
            defaultValue=""
            onChange={(e) => {
              const npc = state.npcs.find((n) => n.id === e.target.value);
              if (npc) addNpc(npc);
              e.target.value = "";
            }}
          >
            <option value="">+ inimigo do catálogo…</option>
            {state.npcs.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} (HP {n.hp})
              </option>
            ))}
          </select>
          <select
            defaultValue=""
            onChange={(e) => {
              const obj = state.objects.find((o) => o.id === e.target.value);
              if (obj) addObject(obj);
              e.target.value = "";
            }}
          >
            <option value="">+ objeto do catálogo…</option>
            {state.objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.body}>
          <div
            className={styles.grid}
            style={{ gridTemplateColumns: `repeat(${grid}, 1fr)` }}
          >
            {Array.from({ length: grid * grid }).map((_, idx) => {
              const x = idx % grid;
              const y = Math.floor(idx / grid);
              const tok = cellAt(x, y);
              return (
                <button
                  key={idx}
                  className={`${styles.cell} ${tok ? styles["k_" + tok.kind] : ""} ${
                    tok?.neutral ? styles.k_npc : ""
                  } ${tok && tok.id === selected ? styles.sel : ""}`}
                  onClick={() => (tok ? setSelected(tok.id) : placeAt(x, y))}
                  title={tok?.label}
                >
                  {tok ? tok.label.slice(0, 3) : ""}
                </button>
              );
            })}
          </div>

          <div className={styles.tokens}>
            <p className="muted">
              Selecione um token e clique numa célula vazia para posicioná-lo.
            </p>
            {tokens.map((t) => (
              <div
                key={t.id}
                className={`${styles.tokRow} ${t.id === selected ? styles.tokSel : ""}`}
                onClick={() => setSelected(t.id)}
              >
                <span className={styles["dot_" + t.kind]} />
                <span className={styles.tokName}>{t.label}</span>
                {(t.kind === "enemy" || t.kind === "player") && (
                  <span className={styles.hp}>{t.maxHp ?? 0} HP</span>
                )}
                {t.kind === "object" && t.rule === "item" && (
                  <select
                    value={t.itemId ?? ""}
                    onChange={(e) => updateToken(t.id, { itemId: e.target.value })}
                  >
                    {state.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                )}
                {t.kind === "object" && t.rule && t.rule !== "item" && (
                  <span className={styles.ruleTag}>{OBJECT_RULES[t.rule].badge}</span>
                )}
                <button className="danger" onClick={() => removeToken(t.id)}>
                  x
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.footer}>
          {!hasPlayer && (
            <span className={styles.warn}>adicione ao menos 1 jogador</span>
          )}
          <button onClick={onClose}>Cancelar</button>
          <button className={styles.start} onClick={start} disabled={!hasPlayer}>
            Iniciar batalha
          </button>
        </div>
      </div>
    </div>
  );
}
