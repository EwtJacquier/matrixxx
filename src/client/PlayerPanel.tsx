"use client";

import { useGame } from "./GameProvider";
import type { Character } from "@/game/types";
import { STATES } from "@/game/types";
import styles from "./PlayerPanel.module.css";

export function PlayerPanel({
  character,
  onOpenSheet,
}: {
  character: Character;
  onOpenSheet?: () => void;
}) {
  const { state, session, emit } = useGame();
  if (!state) return null;

  const nameOf = <T extends { id: string; name: string }>(arr: T[], id: string) =>
    arr.find((x) => x.id === id)?.name ?? id;

  const stateIdx = STATES.indexOf(character.state);
  const hpPct = Math.round((character.hp / Math.max(1, character.maxHp)) * 100);

  // Itens consumíveis usáveis fora de combate, só na ficha do próprio jogador.
  const isMine = session?.id === character.userId;
  const outOfBattle = state.game.mode !== "battle";
  const canUse = isMine && outOfBattle;
  const itemCatalog = (id: string) => state.items.find((i) => i.id === id);

  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <div className={styles.avatar}>
          {character.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={character.picture} alt={character.name} />
          ) : (
            <span>?</span>
          )}
        </div>
        <div className={styles.ident}>
          <strong className={styles.name}>{character.name || "sem nome"}</strong>
          <span className={styles.costume}>{character.costume || "— sem disfarce —"}</span>
          <span className={`${styles.state} ${styles["s" + stateIdx]}`}>
            {character.state}
          </span>
        </div>
        <div className={styles.lvlCol}>
          <span className={styles.lvl}>LVL {character.level}</span>
          {onOpenSheet && (
            <button className={styles.sheetBtn} onClick={onOpenSheet}>
              ver ficha
            </button>
          )}
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span>HP</span>
          <div className={styles.hpbar}>
            <i style={{ width: `${hpPct}%` }} />
          </div>
          <b>
            {character.hp}/{character.maxHp}
          </b>
        </div>
        <div className={styles.stat}>
          <span>MV</span>
          <b>{character.mv}</b>
        </div>
        <div className={styles.stat}>
          <span>DF</span>
          <b>{character.df}</b>
        </div>
      </div>

      <div className={styles.lists}>
        <div className={styles.section}>
          <span className={styles.label}>Profissões</span>
          <div className={styles.chips}>
            {character.roles.map((r) => (
              <span key={r} className={styles.chip}>
                {nameOf(state.professions, r)}
              </span>
            ))}
            {character.roles.length === 0 && <span className="muted">—</span>}
          </div>
        </div>
        <div className={styles.section}>
          <span className={styles.label}>Hacks</span>
          <div className={styles.chips}>
            {character.hacks.map((h) => (
              <span key={h} className={styles.chip}>
                {nameOf(state.hacks, h)}
              </span>
            ))}
            {character.hacks.length === 0 && <span className="muted">—</span>}
          </div>
        </div>
        <div className={styles.section}>
          <span className={styles.label}>Itens</span>
          <div className={styles.chips}>
            {character.items.map((it, i) => {
              const usable = canUse && !!itemCatalog(it.id)?.heal;
              return (
                <span key={i} className={styles.chip}>
                  {nameOf(state.items, it.id)}
                  {it.qty > 1 ? ` ×${it.qty}` : ""}
                  {usable && (
                    <button
                      className={styles.useBtn}
                      onClick={() =>
                        emit("item:use", { characterId: character.id, itemId: it.id })
                      }
                    >
                      usar
                    </button>
                  )}
                </span>
              );
            })}
            {character.items.length === 0 && <span className="muted">—</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
