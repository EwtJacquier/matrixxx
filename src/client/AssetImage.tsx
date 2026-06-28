"use client";

import { useEffect } from "react";
import { useGame } from "./GameProvider";

type AssetKind = "scenarios" | "characters" | "npcs";

/**
 * Imagem buscada sob demanda (fora do estado do socket). Usa `inline` quando há
 * um data URL recém-carregado (ex.: upload no editor); senão pede ao servidor via
 * o cache de assets do GameProvider e renderiza quando chega. Enquanto não há
 * imagem, mostra `fallback` (ou nada).
 */
export function AssetImage({
  kind,
  id,
  ver,
  inline,
  alt = "",
  className,
  fallback = null,
}: {
  kind: AssetKind;
  id: string;
  ver?: number;
  /** data URL local (upload em andamento) — tem prioridade sobre o cache. */
  inline?: string;
  alt?: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const { assets, requestAsset } = useGame();
  const key = `${kind}:${id}:${ver ?? 0}`;
  const cached = assets[key];
  const src = inline || cached;

  useEffect(() => {
    if (!inline && id) requestAsset(kind, id, ver ?? 0);
  }, [inline, kind, id, ver, requestAsset]);

  if (!src) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}
