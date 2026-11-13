import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/session";

export const POST = handler(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
});
