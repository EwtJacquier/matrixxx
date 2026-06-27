import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { initStore } from "@/server/data/store";
import { SESSION_COOKIE, verifyToken } from "@/server/auth/session";
import { availableRoles, getUserById } from "@/server/auth/users";

export const dynamic = "force-dynamic";

export async function GET() {
  await initStore();
  const token = cookies().get(SESSION_COOKIE)?.value;
  const userId = verifyToken(token);
  const user = userId ? getUserById(userId) : null;
  return NextResponse.json({ user, roles: availableRoles() });
}
