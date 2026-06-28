"use client";

import { useGame } from "./GameProvider";
import type { Character } from "@/game/types";
import { STATES } from "@/game/types";
import { combatBonusLabel } from "@/game/professions";
import { FREE_HANDS } from "@/game/weapons";
import { AssetImage } from "./AssetImage";
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

  // Profissões do personagem, separadas por tipo.
  const myProfs = character.roles
    .map((id) => state.professions.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const combatProfs = myProfs.filter((p) => p.kind === "combat");
  const rpProfs = myProfs.filter((p) => p.kind === "rp");

  const stateIdx = STATES.indexOf(character.state);
  const hpPct = Math.round((character.hp / Math.max(1, character.maxHp)) * 100);

  // Itens consumíveis usáveis fora de combate, só na ficha do próprio jogador.
  const isMine = session?.id === character.userId;
  const outOfBattle = state.game.mode !== "battle";
  const canUse = isMine && outOfBattle;
  const isGM = session?.role === "gm";
  const itemCatalog = (id: string) => state.items.find((i) => i.id === id);

  // GM, fora de combate, restaura HP cheio e estado "Disposto" do personagem.
  function gmRestore() {
    emit("character:save", { ...character, hp: character.maxHp, state: "Disposto" });
  }

  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <div className={styles.avatar}>
          <AssetImage
            kind="characters"
            id={character.id}
            ver={character.pictureVer}
            alt={character.name}
            fallback={<span>?</span>}
          />
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
          {isGM && (
            <button className={styles.sheetBtn} onClick={gmRestore}>
              restaurar
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
          <span className={styles.label}>Combate</span>
          <div className={styles.profList}>
            {combatProfs.map((p) => (
              <div key={p.id} className={`${styles.profRow} ${styles.profCombat}`}>
                <span className={styles.profName}>
                  {p.name}
                  {p.hack_found && <span className={styles.hackDot} title="hack disponível">⌁</span>}
                </span>
                {combatBonusLabel(p) && (
                  <span className={styles.profBonus}>{combatBonusLabel(p)}</span>
                )}
              </div>
            ))}
            {combatProfs.length === 0 && <span className="muted">—</span>}
          </div>
        </div>
        <div className={styles.section}>
          <span className={styles.label}>RP</span>
          <div className={styles.profList}>
            {rpProfs.map((p) => (
              <div key={p.id} className={`${styles.profRow} ${styles.profRp}`}>
                <span className={styles.profName}>
                  {p.name}
                  {p.hack_found && <span className={styles.hackDot} title="hack disponível">⌁</span>}
                </span>
                <span className={styles.profDesc}>{p.description}</span>
              </div>
            ))}
            {rpProfs.length === 0 && <span className="muted">—</span>}
          </div>
        </div>
        <div className={styles.section}>
          <span className={styles.label}>Itens</span>
          <div className={styles.chips}>
            {/* Mãos Livres é embutida e sempre presente. */}
            <span className={styles.chip}>{FREE_HANDS.name}</span>
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
          </div>
        </div>
      </div>
    </div>
  );
}
