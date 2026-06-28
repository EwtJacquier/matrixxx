"use client";

import { useCallback, useEffect, useState } from "react";
import { useMobile } from "./useMobile";
import styles from "./MobileGate.module.css";

/**
 * No mobile, exige tela cheia em modo paisagem antes de mostrar a mesa.
 * - Sem tela cheia → tela preta pedindo para entrar.
 * - Em tela cheia → tenta travar a orientação em paisagem; se o aparelho estiver
 *   na vertical (trava não suportada), rotaciona o conteúdo via CSS.
 * - Ao sair da tela cheia, volta para a tela preta.
 * No desktop, é transparente (passa os filhos direto).
 */
export function MobileGate({ children }: { children: React.ReactNode }) {
  const mobile = useMobile();
  const [fs, setFs] = useState(false);
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    const onOrient = () =>
      setPortrait(window.matchMedia("(orientation: portrait)").matches);
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("resize", onOrient);
    window.addEventListener("orientationchange", onOrient);
    onFs();
    onOrient();
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("resize", onOrient);
      window.removeEventListener("orientationchange", onOrient);
    };
  }, []);

  const enter = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* ignore */
    }
    try {
      const orient = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      await orient.lock?.("landscape");
    } catch {
      /* trava não suportada (ex.: iOS) — caímos no rotate via CSS */
    }
  }, []);

  if (!mobile) return <>{children}</>;

  if (!fs) {
    return (
      <div className={styles.gate}>
        <div className={styles.gateBox}>
          <p className={styles.brand}>MATRIX</p>
          <p className={styles.sub}>// modo mesa</p>
          <p className={styles.text}>
            No celular, jogue em tela cheia e na horizontal.
          </p>
          <button onClick={enter}>▶ Entrar em tela cheia</button>
        </div>
      </div>
    );
  }

  return <div className={portrait ? styles.rotate : styles.frame}>{children}</div>;
}
