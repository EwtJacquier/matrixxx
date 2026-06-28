"use client";

import { useEffect, useRef, useState } from "react";
import { useGame } from "./GameProvider";
import { useMobile } from "./useMobile";
import type { Roll } from "@/game/types";
import styles from "./DiceStage.module.css";

const DICE = [4, 6, 8, 10, 20] as const;

interface RollResult {
  value: number;
  rolls?: { value: number }[];
}
interface DiceBoxLike {
  init: () => Promise<void>;
  roll: (n: unknown) => Promise<RollResult[]>;
  clear: () => void;
}

/**
 * Palco de dados 3D dentro do scenarioBox. Quem rola anima os dados localmente
 * (a FÍSICA do dado define o valor — assim o que cai no dado é o resultado) e
 * transmite esse valor a todos. Os demais veem o resultado da última rolagem.
 */
export function DiceStage() {
  const { state, lastRoll, emit } = useGame();
  const mobile = useMobile();
  const boxRef = useRef<DiceBoxLike | null>(null);
  const readyRef = useRef(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rolling, setRolling] = useState(false);

  // Inicializa o dice-box uma vez (import dinâmico — usa WebGL/window).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@3d-dice/dice-box");
        const DiceBox = mod.default;
        const box = new DiceBox("#dice-stage", {
          assetPath: "/assets/dice-box/",
          theme: "default",
          themeColor: "#00ff66",
          scale: mobile ? 8 : 6,
          gravity: 2,
        } as Record<string, unknown>) as unknown as DiceBoxLike;
        await box.init();
        if (cancelled) return;
        boxRef.current = box;
        readyRef.current = true;
      } catch {
        /* sem WebGL / assets — degrada para só o resultado em texto */
      }
    })();
    return () => {
      cancelled = true;
      if (clearTimer.current) clearTimeout(clearTimer.current);
      try {
        boxRef.current?.clear();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Última rolagem visível a todos: evento ao vivo, ou o estado compartilhado.
  const shown: Roll | null = lastRoll ?? state?.game.lastRoll ?? null;

  async function rollDie(sides: number) {
    const box = boxRef.current;
    if (rolling) return;
    if (!readyRef.current || !box) {
      // Sem 3D disponível: cai no modo servidor (rola no backend).
      emit("dice:request", { formula: `1d${sides}`, reason: "Rolagem" });
      return;
    }
    setRolling(true);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    try {
      box.clear();
      const res = await box.roll(`1d${sides}`);
      const values = (res ?? []).map((r) => r.value);
      const total = values.reduce((a, b) => a + b, 0);
      // O valor que CAIU no dado é o resultado — transmite a todos.
      emit("dice:result", { formula: `1d${sides}`, total, results: values, reason: "Rolagem" });
    } catch {
      /* ignore */
    }
    clearTimer.current = setTimeout(() => {
      try {
        box.clear();
      } catch {
        /* ignore */
      }
      setRolling(false);
    }, 6000);
  }

  return (
    <>
      {/* canvas dos dados 3D (preenche o scenarioBox; não bloqueia cliques) */}
      <div id="dice-stage" className={styles.canvas} aria-hidden />

      <div className={styles.dock}>
        {DICE.map((d) => (
          <button
            key={d}
            className={styles.die}
            disabled={rolling}
            onClick={() => rollDie(d)}
            title={`Rolar D${d}`}
          >
            D{d}
          </button>
        ))}
      </div>

      {shown && (
        <div className={`${styles.result} ${rolling ? styles.resultRolling : ""}`}>
          <span className={styles.resultTotal}>{shown.total}</span>
          <span className={styles.resultMeta}>
            {shown.formula}
            {shown.results.length > 1 ? ` [${shown.results.join(", ")}]` : ""} ·{" "}
            {shown.author}
          </span>
        </div>
      )}
    </>
  );
}
