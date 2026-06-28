"use client";

import { useEffect, useRef } from "react";
import type { InputAction } from "./input";
import styles from "./TouchControls.module.css";

/**
 * Direcional na tela para o mobile — usado SÓ na movimentação do token (o board
 * não responde a toque/clique para mover). Dispara as mesmas ações do teclado.
 * Repete enquanto o jogador segura a direção. O resto do fluxo (menu, distorção
 * L1/R1, confirmar) é por toque direto no painel de ação.
 */
export function TouchControls({ onInput }: { onInput: (a: InputAction) => void }) {
  const timers = useRef<{ to: ReturnType<typeof setTimeout> | null; iv: ReturnType<typeof setInterval> | null }>(
    { to: null, iv: null },
  );

  const clearRepeat = () => {
    if (timers.current.to) clearTimeout(timers.current.to);
    if (timers.current.iv) clearInterval(timers.current.iv);
    timers.current.to = null;
    timers.current.iv = null;
  };

  useEffect(() => clearRepeat, []);

  const dirProps = (a: InputAction) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      onInput(a);
      clearRepeat();
      timers.current.to = setTimeout(() => {
        timers.current.iv = setInterval(() => onInput(a), 150);
      }, 320);
    },
    onPointerUp: clearRepeat,
    onPointerLeave: clearRepeat,
    onPointerCancel: clearRepeat,
  });

  return (
    <div className={styles.pad}>
      <div className={styles.dpad}>
        <button className={`${styles.btn} ${styles.up}`} {...dirProps("up")}>
          ▲
        </button>
        <button className={`${styles.btn} ${styles.left}`} {...dirProps("left")}>
          ◀
        </button>
        <button className={`${styles.btn} ${styles.right}`} {...dirProps("right")}>
          ▶
        </button>
        <button className={`${styles.btn} ${styles.down}`} {...dirProps("down")}>
          ▼
        </button>
      </div>
    </div>
  );
}
