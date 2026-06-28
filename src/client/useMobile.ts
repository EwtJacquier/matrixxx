"use client";

import { useEffect, useState } from "react";

/**
 * Detecta um dispositivo móvel: ponteiro grosso (touch) + tela pequena (a menor
 * dimensão da janela). Reavalia em resize/rotação. Também marca `html.mobile`
 * para overrides de CSS global.
 */
export function useMobile(): boolean {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
      const small = Math.min(window.innerWidth, window.innerHeight) <= 820;
      const isMobile = coarse && small;
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
