// Sessão simples: token assinado com HMAC, sem dependências externas além do crypto.
// Sem recuperação de senha (conforme o brief).

import crypto from "crypto";

const SECRET =
  process.env.SESSION_SECRET ?? "matrix-rpg-dev-secret-troque-em-producao";

export const SESSION_COOKIE = "matrix_session";

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function createToken(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyToken(token: string | undefined): string | null {
  if (!token) return null;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;
  const expected = sign(encoded);
  // comparação em tempo constante
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = Buffer.from(encoded, "base64url").toString("utf8");
    const [userId] = payload.split(".");
    return userId || null;
  } catch {
    return null;
  }
}
