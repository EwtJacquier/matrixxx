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

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
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
    socket.on("battle:damage", ({ events }: { events: DamageEvent[] }) => {
      const base = Date.now();
      const popups = events.map((e, i) => ({ ...e, key: base + i }));
      setDamagePopups((cur) => [...cur, ...popups]);
      // remove os popups após a animação
      const keys = new Set(popups.map((p) => p.key));
      setTimeout(() => {
        setDamagePopups((cur) => cur.filter((p) => !keys.has(p.key)));
      }, 1400);
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

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const emit = useCallback((event: string, payload?: unknown) => {
    socketRef.current?.emit(event, payload);
  }, []);

  return (
    <GameContext.Provider
      value={{ connected, session, state, lastRoll, damagePopups, battleIntent, turnEndsAt, error, authExpired, emit }}
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
