"use client";

import { useGame } from "./GameProvider";
import type { Character } from "@/game/types";
import { STATES } from "@/game/types";
import styles from "./PlayerPanel.module.css";

export function PlayerPanel({ character }: { character: Character }) {
  const { state } = useGame();
  if (!state) return null;

  const nameOf = <T extends { id: string; name: string }>(arr: T[], id: string) =>
    arr.find((x) => x.id === id)?.name ?? id;

  const stateIdx = STATES.indexOf(character.state);
  const hpPct = Math.round((character.hp / Math.max(1, character.maxHp)) * 100);

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
        <div className={styles.lvl}>LVL {character.level}</div>
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
        <div>
          <span className={styles.label}>Profissões</span>
          <ul>
            {character.roles.map((r) => (
              <li key={r}>{nameOf(state.professions, r)}</li>
            ))}
            {character.roles.length === 0 && <li className="muted">—</li>}
          </ul>
        </div>
        <div>
          <span className={styles.label}>Hacks</span>
          <ul>
            {character.hacks.map((h) => (
              <li key={h}>{nameOf(state.hacks, h)}</li>
            ))}
            {character.hacks.length === 0 && <li className="muted">—</li>}
          </ul>
        </div>
        <div>
          <span className={styles.label}>Itens ({character.items.length}/10)</span>
          <ul>
            {character.items.map((it, i) => (
              <li key={i}>{nameOf(state.items, it)}</li>
            ))}
            {character.items.length === 0 && <li className="muted">—</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
