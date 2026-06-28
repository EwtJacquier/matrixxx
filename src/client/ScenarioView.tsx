"use client";

import { useMemo, useState } from "react";
import { useGame } from "./GameProvider";
import { PlayerPanel } from "./PlayerPanel";
import { BattleSetup } from "./BattleSetup";
import { playSfx } from "./sfx";
import styles from "./ScenarioView.module.css";

export function ScenarioView({
  onOpenSheet,
  battleActive,
}: {
  onOpenSheet?: () => void;
  battleActive?: boolean;
}) {
  const { state, session, emit } = useGame();
  const [setup, setSetup] = useState(false);
  const isGM = session?.role === "gm";

  const scenario = useMemo(
    () => state?.scenarios.find((s) => s.id === state.game.scenarioId) ?? null,
    [state],
  );

  if (!state) return null;
  const { distortion } = state.game;

  return (
    <div className={styles.layout}>
      <section className={styles.stage}>
        <div className={styles.scenarioBox}>
          {scenario?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={scenario.image} alt={scenario.name} className={styles.image} />
          ) : (
            <div className={styles.noImage}>[ sem imagem de cenário ]</div>
          )}
          <div className={styles.scenarioName}>{scenario?.name ?? "—"}</div>
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
        {state.characters.length === 0 && (
          <p className="muted">Nenhuma ficha criada ainda.</p>
        )}
        {state.characters.map((c) => (
          <PlayerPanel
            key={c.id}
            character={c}
            onOpenSheet={c.userId === session?.id ? onOpenSheet : undefined}
          />
        ))}
      </aside>

      {setup && <BattleSetup onClose={() => setSetup(false)} />}
    </div>
  );
}
