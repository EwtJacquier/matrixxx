"use client";

import { useMemo, useState } from "react";
import { useGame } from "./GameProvider";
import { PlayerPanel } from "./PlayerPanel";
import { BattleSetup } from "./BattleSetup";
import { DiceStage } from "./DiceStage";
import { AssetImage } from "./AssetImage";
import { playSfx } from "./sfx";
import styles from "./ScenarioView.module.css";

export function ScenarioView({
  onOpenSheet,
  battleActive,
  onSpectate,
}: {
  onOpenSheet?: () => void;
  battleActive?: boolean;
  onSpectate?: () => void;
}) {
  const { state, session, emit } = useGame();
  const [setup, setSetup] = useState(false);
  const [playerTab, setPlayerTab] = useState(0);
  const isGM = session?.role === "gm";

  const scenario = useMemo(
    () => state?.scenarios.find((s) => s.id === state.game.scenarioId) ?? null,
    [state],
  );

  if (!state) return null;
  const { distortion } = state.game;

  // Lista de jogadores em abas; o personagem do jogador atual vem primeiro.
  const myId = session?.id;
  const characters = [...state.characters].sort(
    (a, b) => Number(b.userId === myId && !isGM) - Number(a.userId === myId && !isGM),
  );
  const selIdx = Math.min(playerTab, Math.max(0, characters.length - 1));
  const selected = characters[selIdx] ?? null;

  return (
    <div className={styles.layout}>
      <section className={styles.stage}>
        <div className={styles.scenarioBox}>
          {scenario ? (
            <AssetImage
              kind="scenarios"
              id={scenario.id}
              ver={scenario.imageVer}
              alt={scenario.name}
              className={styles.image}
              fallback={<div className={styles.noImage}>[ sem imagem de cenário ]</div>}
            />
          ) : (
            <div className={styles.noImage}>[ sem imagem de cenário ]</div>
          )}
          <div className={styles.scenarioName}>{scenario?.name ?? "—"}</div>
          <DiceStage />
        </div>

        <div className={styles.distortion}>
          <span>DISTORÇÃO DO CENÁRIO</span>
          <div className={styles.bar}>
            {Array.from({ length: 11 }).map((_, i) => (
              <span
                key={i}
                className={i <= distortion ? styles.cellOn : styles.cell}
              />
            ))}
          </div>
          <strong>{distortion} / 10</strong>
          {isGM && (
            <div className={styles.distControls}>
              <button
                onClick={() => {
                  if (distortion <= 0) return;
                  playSfx("distortion");
                  emit("gm:setDistortion", { value: distortion - 1 });
                }}
              >
                -
              </button>
              <button
                onClick={() => {
                  if (distortion >= 10) return;
                  playSfx("distortion");
                  emit("gm:setDistortion", { value: distortion + 1 });
                }}
              >
                +
              </button>
            </div>
          )}
        </div>

        {onSpectate && (
          <div className={styles.spectateBar}>
            <button onClick={onSpectate}>Ver último combate</button>
          </div>
        )}

        {isGM && (
          <div className={styles.gmBar}>
            <label>
              Cenário:
              <select
                value={scenario?.id ?? ""}
                onChange={(e) => emit("gm:setScenario", { scenarioId: e.target.value })}
              >
                {state.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => setSetup(true)}>Novo Combate</button>
            {battleActive && (
              <button onClick={() => emit("gm:resumeBattle")}>Resumir Combate</button>
            )}
          </div>
        )}
      </section>

      <aside className={styles.players}>
        <h2>Jogadores</h2>
        {characters.length === 0 && (
          <p className="muted">Nenhuma ficha criada ainda.</p>
        )}
        {characters.length > 0 && (
          <>
            <div className={styles.playerTabs}>
              {characters.map((c, i) => (
                <button
                  key={c.id}
                  className={`${styles.playerTab} ${i === selIdx ? styles.playerTabOn : ""}`}
                  onClick={() => setPlayerTab(i)}
                  title={c.name || "sem nome"}
                >
                  <span className={styles.playerTabAvatar}>
                    <AssetImage
                      kind="characters"
                      id={c.id}
                      ver={c.pictureVer}
                      alt={c.name}
                      fallback={<span>?</span>}
                    />
                  </span>
                  <span className={styles.playerTabName}>
                    {c.name || "sem nome"}
                    {c.userId === myId ? " ●" : ""}
                  </span>
                </button>
              ))}
            </div>
            {selected && (
              <PlayerPanel
                key={selected.id}
                character={selected}
                onOpenSheet={selected.userId === myId ? onOpenSheet : undefined}
              />
            )}
          </>
        )}
      </aside>

      {setup && <BattleSetup onClose={() => setSetup(false)} />}
    </div>
  );
}
