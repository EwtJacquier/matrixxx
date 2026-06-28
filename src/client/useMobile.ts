"use client";

import { useEffect, useState } from "react";

/** Avalia se é mobile AGORA (ponteiro grosso + tela pequena). SSR-safe. */
function computeMobile(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const small = Math.min(window.innerWidth, window.innerHeight) <= 820;
  return coarse && small;
}

/**
 * Detecta um dispositivo móvel. O valor já vem correto no PRIMEIRO render do
 * cliente (inicializador síncrono) — isso evita uma janela em que `false` dispara
 * efeitos indesejados (ex.: a música começar a tocar antes do flag virar true).
 * Reavalia em resize/rotação e marca `html.mobile` para overrides de CSS.
 */
export function useMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(computeMobile);

  useEffect(() => {
    const check = () => {
      const isMobile = computeMobile();
      setMobile(isMobile);
      document.documentElement.classList.toggle("mobile", isMobile);
    };
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  return mobile;
}
