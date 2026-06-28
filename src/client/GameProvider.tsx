"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import type { DamageEvent, PublicState, Roll } from "@/game/types";
import { playSfx } from "./sfx";

interface Session {
  id: string;
  email: string;
  role: "gm" | "player";
}

export interface DamagePopup extends DamageEvent {
  key: number;
}

/** Planejamento de turno compartilhado (feedback visual para todos). */
export interface BattleIntent {
  actorId: string;
  staged: { x: number; y: number } | null;
  mode: string;
  moveCharges: number;
  attackCharges: number;
  weaponId: string;
  targetId: string;
}

interface GameContextValue {
  connected: boolean;
  session: Session | null;
  state: PublicState | null;
  lastRoll: Roll | null;
  damagePopups: DamagePopup[];
  battleIntent: BattleIntent | null;
  turnEndsAt: number;
  /** offset (ms) entre o relógio do servidor e o do cliente: serverNow ≈ Date.now() + clockOffset.
   * Torna o timer imune à diferença de relógio entre o aparelho e o servidor. */
  clockOffset: number;
  /** áudio (data URL) da faixa pedida via music:track, entregue sob demanda. */
  trackData: { id: string; src: string } | null;
  /** imagens (data URL) buscadas sob demanda, em cache por `kind:id:ver`. */
  assets: Record<string, string>;
  /** pede a imagem de uma entidade (de-dup automático); retorna a key do cache. */
  requestAsset: (kind: "scenarios" | "characters" | "npcs", id: string, ver?: number) => string;
  error: string | null;
  authExpired: boolean;
  emit: (event: string, payload?: unknown) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<PublicState | null>(null);
  const [lastRoll, setLastRoll] = useState<Roll | null>(null);
  const [damagePopups, setDamagePopups] = useState<DamagePopup[]>([]);
  const [battleIntent, setBattleIntent] = useState<BattleIntent | null>(null);
  const [turnEndsAt, setTurnEndsAt] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const assetsRef = useRef<Record<string, string>>({});
  assetsRef.current = assets;
  const assetPending = useRef<Set<string>>(new Set());
  const [trackData, setTrackData] = useState<{ id: string; src: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);

  useEffect(() => {
    const socket = io({ withCredentials: true });
    socketRef.current = socket;

    // Logo após criar conta, o cookie de sessão pode ainda não estar disponível
    // na primeira tentativa de handshake. Em vez de desistir (e antes causava
    // reload em loop), tentamos reconectar algumas vezes; só após esgotar é que
    // mostramos "sessão inválida".
    let authAttempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const MAX_AUTH_RETRIES = 4;

    // Sincroniza o relógio com o servidor (corrige skew client↔server no timer).
    const syncClock = () => socket.emit("time:sync", { t0: Date.now() });
    let clockTimer: ReturnType<typeof setInterval> | null = null;

    socket.on("connect", () => {
      setConnected(true);
      syncClock();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("time:pong", ({ serverNow, t0 }: { serverNow: number; t0: number }) => {
      const rtt = Date.now() - t0;
      // serverNow vale ~no meio do round-trip; corrige pela metade do RTT.
      setClockOffset(serverNow + rtt / 2 - Date.now());
    });
    socket.on("session", () => {
      authAttempts = 0;
      setAuthExpired(false);
    });
    socket.on("state", (s: PublicState) => setState(s));
    socket.on("dice:roll", (r: Roll) => setLastRoll(r));
    socket.on("battle:intent", (p: BattleIntent) => setBattleIntent(p));
    socket.on("battle:timer", ({ turnEndsAt: t }: { turnEndsAt: number }) =>
      setTurnEndsAt(t),
    );
    socket.on("music:data", (d: { id: string; src: string }) => setTrackData(d));
    socket.on("asset:data", ({ key, data }: { key: string; data: string }) => {
      assetPending.current.delete(key);
      setAssets((cur) => (cur[key] === data ? cur : { ...cur, [key]: data }));
    });
    socket.on("battle:damage", ({ events }: { events: DamageEvent[] }) => {
      // Som de laser sempre que o dano aparece (um por alvo atingido).
      events.forEach(() => playSfx("laser"));
      const base = Date.now();
      const popups = events.map((e, i) => ({ ...e, key: base + i }));
      setDamagePopups((cur) => [...cur, ...popups]);
      // remove os popups após a animação (deve casar com dmgRise no CSS)
      const keys = new Set(popups.map((p) => p.key));
      setTimeout(() => {
        setDamagePopups((cur) => cur.filter((p) => !keys.has(p.key)));
      }, 2400);
    });
    socket.on("game:error", ({ message }: { message: string }) => {
      setError(message);
      setTimeout(() => setError(null), 4000);
    });
    socket.on("unauthorized", () => {
      socket.disconnect();
      if (authAttempts < MAX_AUTH_RETRIES) {
        authAttempts += 1;
        retryTimer = setTimeout(() => socket.connect(), 500);
      } else {
        setAuthExpired(true);
      }
    });

    clockTimer = setInterval(syncClock, 20000);

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (clockTimer) clearInterval(clockTimer);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const emit = useCallback((event: string, payload?: unknown) => {
    socketRef.current?.emit(event, payload);
  }, []);

  const requestAsset = useCallback(
    (kind: "scenarios" | "characters" | "npcs", id: string, ver = 0) => {
      const key = `${kind}:${id}:${ver}`;
      if (!assetsRef.current[key] && !assetPending.current.has(key)) {
        assetPending.current.add(key);
        socketRef.current?.emit("asset:get", { kind, id });
      }
      return key;
    },
    [],
  );

  return (
    <GameContext.Provider
      value={{ connected, session, state, lastRoll, damagePopups, battleIntent, turnEndsAt, clockOffset, trackData, assets, requestAsset, error, authExpired, emit }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame deve ser usado dentro de GameProvider.");
  return ctx;
}
