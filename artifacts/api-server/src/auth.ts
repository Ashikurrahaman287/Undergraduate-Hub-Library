import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import {
  adminSessionsTable,
  db,
  membersTable,
  userRolesTable,
} from "@workspace/db";

export const ADMIN_SESSION_COOKIE = "uh_admin_session";
const DEFAULT_SESSION_SECONDS = 8 * 60 * 60;
const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60;

export type AdminRole = "staff" | "admin" | "super_admin";
export type AdminPermission =
  | "books.view"
  | "books.create"
  | "books.update"
  | "members.view"
  | "members.create"
  | "members.update"
  | "payments.view"
  | "payments.create"
  | "circulation.view"
  | "circulation.approve"
  | "reports.view"
  | "analytics.view";

export type AdminIdentity = {
  userId: string;
  memberId: string;
  email: string;
  name: string;
  role: AdminRole;
  permissions: ReadonlySet<AdminPermission>;
};

type AdminRequest = Request & { admin?: AdminIdentity };

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  staff: [
    "books.view",
    "members.view",
    "circulation.view",
    "circulation.approve",
  ],
  admin: [
    "books.view",
    "books.create",
    "books.update",
    "members.view",
    "members.create",
    "members.update",
    "payments.view",
    "payments.create",
    "circulation.view",
    "circulation.approve",
    "reports.view",
    "analytics.view",
  ],
  super_admin: [
    "books.view",
    "books.create",
    "books.update",
    "members.view",
    "members.create",
    "members.update",
    "payments.view",
    "payments.create",
    "circulation.view",
    "circulation.approve",
    "reports.view",
    "analytics.view",
  ],
};

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  const prefix = `${name}=`;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}

function isAdminRole(role: string): role is AdminRole {
  return role === "staff" || role === "admin" || role === "super_admin";
}

async function findAdminByUserId(userId: string): Promise<AdminIdentity | null> {
  const [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.authUserId, userId))
    .limit(1);
  if (!member) return null;

  const [assignment] = await db
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId))
    .limit(1);
  const role = assignment?.role ?? member.role;
  if (!isAdminRole(role)) return null;

  return {
    userId,
    memberId: member.id,
    email: member.email ?? "",
    name: member.name,
    role,
    permissions: new Set(ROLE_PERMISSIONS[role]),
  };
}

export async function getAuthenticatedAdmin(request: Request) {
  const rawToken = getCookieValue(request, ADMIN_SESSION_COOKIE);
  if (!rawToken || rawToken.length < 32) return null;

  const [session] = await db
    .select()
    .from(adminSessionsTable)
    .where(
      and(
        eq(adminSessionsTable.tokenHash, hashSessionToken(rawToken)),
        gt(adminSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) return null;

  const identity = await findAdminByUserId(session.userId);
  if (!identity) {
    await db.delete(adminSessionsTable).where(eq(adminSessionsTable.id, session.id));
    return null;
  }

  await db
    .update(adminSessionsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(adminSessionsTable.id, session.id));
  return identity;
}

export function requireAdmin(permission?: AdminPermission) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const identity = await getAuthenticatedAdmin(request);
      if (!identity) {
        response.status(401).json({ error: "Administrator authentication required." });
        return;
      }
      if (permission && !identity.permissions.has(permission)) {
        response.status(403).json({ error: "You are not authorized for this action." });
        return;
      }
      (request as AdminRequest).admin = identity;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function createAdminSession(userId: string, rememberSession: boolean) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() +
      (rememberSession ? REMEMBERED_SESSION_SECONDS : DEFAULT_SESSION_SECONDS) * 1000,
  );
  await db.insert(adminSessionsTable).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
    createdAt: now,
    lastSeenAt: now,
  });
  return { token, expiresAt };
}

export async function revokeAdminSession(request: Request) {
  const rawToken = getCookieValue(request, ADMIN_SESSION_COOKIE);
  if (!rawToken) return;
  await db
    .delete(adminSessionsTable)
    .where(eq(adminSessionsTable.tokenHash, hashSessionToken(rawToken)));
}

export function setAdminSessionCookie(response: Response, token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`,
  );
}

export function clearAdminSessionCookie(response: Response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export function adminSessionResponse(identity: AdminIdentity | null) {
  return identity
    ? {
        authenticated: true,
        user: { email: identity.email, name: identity.name, role: identity.role },
      }
    : { authenticated: false, user: null };
}

export async function authenticateAdminWithSupabase(email: string, password: string) {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return { kind: "not_configured" as const };
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) return { kind: "invalid_credentials" as const };

  const payload = (await response.json()) as { user?: { id?: string; email?: string } };
  const userId = payload.user?.id;
  if (!userId) return { kind: "invalid_credentials" as const };

  const identity = await findAdminByUserId(userId);
  if (!identity) return { kind: "not_authorized" as const };
  return { kind: "authenticated" as const, identity };
}
