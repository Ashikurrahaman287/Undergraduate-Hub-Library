import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, count, desc, eq, gt, isNull, lt } from "drizzle-orm";
import {
  adminSessionsTable,
  db,
  memberSessionsTable,
  membersTable,
  otpChallengesTable,
  userRolesTable,
} from "@workspace/db";
import { normalizeBangladeshiPhone } from "./phone.js";
import { sendOtpSms } from "./services/sms.js";

export const ADMIN_SESSION_COOKIE = "uh_admin_session";
export const MEMBER_SESSION_COOKIE = "uh_member_session";
const DEFAULT_SESSION_SECONDS = 8 * 60 * 60;
const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60;
const MEMBER_SESSION_SECONDS = 30 * 24 * 60 * 60;
const OTP_TTL_SECONDS = 5 * 60;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const OTP_HOURLY_LIMIT = 5;
const VERIFICATION_TOKEN_SECONDS = 10 * 60;
export type OtpPurpose = "member_signup" | "member_reset" | "admin_setup";
export type VerificationChannel = "phone" | "email";

export type AdminRole = "staff" | "admin" | "super_admin";
export type AdminPermission =
  | "books.view"
  | "books.create"
  | "books.update"
  | "books.delete"
  | "books.import"
  | "books.export"
  | "members.view"
  | "members.create"
  | "members.update"
  | "members.suspend"
  | "payments.view"
  | "payments.create"
  | "payments.update"
  | "circulation.view"
  | "circulation.approve"
  | "circulation.return"
  | "circulation.extend"
  | "reports.view"
  | "reports.export"
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
export type MemberIdentity = {
  userId: string;
  memberId: string;
  phone: string;
  name: string;
};
type MemberRequest = Request & { member?: MemberIdentity };

export function getRequiredMember(request: Request) {
  const member = (request as MemberRequest).member;
  if (!member) throw new Error("Member identity is missing.");
  return member;
}

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
    "books.export",
    "members.view",
    "members.create",
    "members.update",
    "members.suspend",
    "payments.view",
    "payments.create",
    "payments.update",
    "circulation.view",
    "circulation.approve",
    "circulation.return",
    "circulation.extend",
    "reports.view",
    "reports.export",
    "analytics.view",
  ],
  super_admin: [
    "books.view",
    "books.create",
    "books.update",
    "books.delete",
    "books.import",
    "books.export",
    "members.view",
    "members.create",
    "members.update",
    "members.suspend",
    "payments.view",
    "payments.create",
    "payments.update",
    "circulation.view",
    "circulation.approve",
    "circulation.return",
    "circulation.extend",
    "reports.view",
    "reports.export",
    "analytics.view",
  ],
};

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashOtp(otp: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return createHash("sha256").update(`${secret}:${otp}`).digest("hex");
}

function hashVerificationToken(token: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return createHash("sha256").update(`${secret}:verification:${token}`).digest("hex");
}

function createVerificationToken() {
  return randomBytes(32).toString("base64url");
}

function configuredAdminPhones() {
  const configured = [
    ...(process.env.ADMIN_PHONE_NUMBERS?.split(",") ?? []),
    ...(process.env.ADMIN_PHONE_NUMBER ? [process.env.ADMIN_PHONE_NUMBER] : []),
  ].map((value) => value.trim()).filter(Boolean);
  if (!configured.length) throw new Error("ADMIN_PHONE_NUMBERS is not configured.");
  return [...new Set(configured.map(normalizeBangladeshiPhone))];
}

function isConfiguredAdminPhone(value: string | null | undefined) {
  if (!value) return false;
  try {
    return configuredAdminPhones().includes(normalizeBangladeshiPhone(value));
  } catch {
    return false;
  }
}

function configuredAdminEmail() {
  const value = process.env.ADMIN_INITIAL_EMAIL ?? process.env.ADMIN_EMAIL;
  if (!value) throw new Error("ADMIN_INITIAL_EMAIL is not configured.");
  return normalizeEmail(value);
}

export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

function isConfiguredAdminEmail(value: string | null | undefined) {
  if (!value) return false;
  try {
    return normalizeEmail(value) === configuredAdminEmail();
  } catch {
    return false;
  }
}

function phoneAliasEmail(phone: string) {
  return `${phone.replace(/\D/g, "")}@phone.undergraduatehub.local`;
}

function safeTokenMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
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

export { normalizeBangladeshiPhone } from "./phone.js";

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
  if (!isConfiguredAdminPhone(member.phone) && !isConfiguredAdminEmail(member.email)) return null;

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

async function findMemberByUserId(userId: string): Promise<MemberIdentity | null> {
  const [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.authUserId, userId))
    .limit(1);
  if (!member || member.status === "suspended") return null;
  return { userId, memberId: member.id, phone: member.phone ?? "", name: member.name };
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

export async function getAuthenticatedMember(request: Request) {
  const rawToken = getCookieValue(request, MEMBER_SESSION_COOKIE);
  if (!rawToken || rawToken.length < 32) return null;

  const [session] = await db
    .select()
    .from(memberSessionsTable)
    .where(
      and(
        eq(memberSessionsTable.tokenHash, hashSessionToken(rawToken)),
        gt(memberSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) return null;

  const identity = await findMemberByUserId(session.userId);
  if (!identity || identity.memberId !== session.memberId) {
    await db.delete(memberSessionsTable).where(eq(memberSessionsTable.id, session.id));
    return null;
  }

  await db
    .update(memberSessionsTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(memberSessionsTable.id, session.id));
  return identity;
}

export function requireMember() {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const identity = await getAuthenticatedMember(request);
      if (!identity) {
        response.status(401).json({ error: "Member authentication required." });
        return;
      }
      (request as MemberRequest).member = identity;
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

export async function createMemberSession(userId: string, memberId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MEMBER_SESSION_SECONDS * 1000);
  await db.insert(memberSessionsTable).values({
    userId,
    memberId,
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

export async function revokeMemberSession(request: Request) {
  const rawToken = getCookieValue(request, MEMBER_SESSION_COOKIE);
  if (!rawToken) return;
  await db
    .delete(memberSessionsTable)
    .where(eq(memberSessionsTable.tokenHash, hashSessionToken(rawToken)));
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

export function setMemberSessionCookie(response: Response, token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${MEMBER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`,
  );
}

export function clearMemberSessionCookie(response: Response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${MEMBER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
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

export function memberSessionResponse(identity: MemberIdentity | null) {
  return identity
    ? {
        authenticated: true,
        user: { name: identity.name, phone: identity.phone },
      }
    : { authenticated: false, user: null };
}

export async function authenticateAdminWithSupabase(email: string, password: string) {
  if (!hasSupabaseAuthAccess()) {
    return { kind: "not_configured" as const };
  }

  const response = await supabaseRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }, "anon");
  if (!response.ok) return { kind: "invalid_credentials" as const };

  const payload = (await response.json()) as { user?: { id?: string; email?: string } };
  const userId = payload.user?.id;
  if (!userId) return { kind: "invalid_credentials" as const };

  const identity = await findAdminByUserId(userId);
  if (!identity) return { kind: "not_authorized" as const };
  return { kind: "authenticated" as const, identity };
}

export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey, serviceRoleKey };
}

function hasSupabaseAuthAccess() {
  return Boolean(getSupabaseConfig() || process.env.REPLIT_CONNECTORS_HOSTNAME);
}

function hasSupabaseServiceAccess() {
  return Boolean(getSupabaseConfig()?.serviceRoleKey || process.env.REPLIT_CONNECTORS_HOSTNAME);
}

type SupabaseRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

async function supabaseRequest(
  path: string,
  init: SupabaseRequestInit = {},
  access: "anon" | "service",
) {
  const requestHeaders = { ...(init.headers ?? {}) };
  if (init.body && !Object.keys(requestHeaders).some((key) => key.toLowerCase() === "content-type")) {
    requestHeaders["Content-Type"] = "application/json";
  }
  const config = getSupabaseConfig();
  if (config) {
    const apiKey = access === "service" ? config.serviceRoleKey : config.anonKey;
    if (!apiKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
    const headers = new Headers(requestHeaders);
    headers.set("apikey", apiKey);
    if (access === "service") headers.set("Authorization", `Bearer ${apiKey}`);
    return fetch(`${config.url}${path}`, { ...init, headers });
  }
  if (!process.env.REPLIT_CONNECTORS_HOSTNAME) {
    throw new Error("Supabase authentication is not configured.");
  }
  return new ReplitConnectors().proxy("supabase", path, {
    ...init,
    headers: requestHeaders,
  });
}

export async function requestAdminPasswordReset(email: string) {
  if (!hasSupabaseAuthAccess()) return { kind: "not_configured" as const };
  let normalizedEmail: string;
  try {
    normalizedEmail = normalizeEmail(email);
  } catch {
    return { kind: "accepted" as const };
  }
  if (!isConfiguredAdminEmail(normalizedEmail)) return { kind: "accepted" as const };

  const redirectTo = process.env.ADMIN_PASSWORD_RESET_REDIRECT_URL;
  const response = await supabaseRequest("/auth/v1/recover", {
    method: "POST",
    body: JSON.stringify({
      email: normalizedEmail,
      ...(redirectTo ? { redirect_to: redirectTo } : {}),
    }),
  }, "anon");
  if (!response.ok && response.status !== 400) {
    throw new Error("Unable to start password recovery.");
  }
  return { kind: "accepted" as const };
}

export async function updateAdminPassword(accessToken: string, password: string) {
  if (!hasSupabaseAuthAccess()) return { kind: "not_configured" as const };

  const userResponse = await supabaseRequest("/auth/v1/user", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  }, "anon");
  if (!userResponse.ok) return { kind: "invalid_or_expired_token" as const };
  const user = (await userResponse.json()) as { id?: string; email?: string };
  if (!user.id || !isConfiguredAdminEmail(user.email) || !(await findAdminByUserId(user.id))) {
    return { kind: "invalid_or_expired_token" as const };
  }

  const response = await supabaseRequest("/auth/v1/user", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  }, "anon");
  return response.ok
    ? ({ kind: "updated" as const })
    : ({ kind: "invalid_or_expired_token" as const });
}

type SupabaseUserRecord = {
  id?: string;
  email?: string | null;
  phone?: string | null;
};

async function listSupabaseUsers() {
  const response = await supabaseRequest("/auth/v1/admin/users?per_page=1000&page=1", {}, "service");
  if (!response.ok) throw new Error("Unable to load Supabase user records.");
  const payload = (await response.json()) as { users?: SupabaseUserRecord[] };
  return payload.users ?? [];
}

async function ensureSupabaseCredentialUser(
  channel: VerificationChannel,
  identifier: string,
  password: string,
) {
  if (!hasSupabaseServiceAccess()) throw new Error("Supabase service authentication is not configured.");
  const normalized = channel === "phone" ? normalizeBangladeshiPhone(identifier) : normalizeEmail(identifier);
  const email = channel === "phone" ? phoneAliasEmail(normalized) : normalized;
  const users = await listSupabaseUsers();
  const existing = users.find((user) =>
    channel === "phone"
      ? user.phone === normalized || user.email === email
      : user.email?.toLowerCase() === email,
  );
  const body =
    channel === "phone"
      ? {
          email,
          password,
          email_confirm: true,
          ...(existing?.phone ? { phone: existing.phone, phone_confirm: true } : {}),
          user_metadata: { phone: normalized },
        }
      : { email, password, email_confirm: true };

  if (!existing?.id) {
    const createResponse = await supabaseRequest("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify(body),
    }, "service");
    if (createResponse.ok) {
      const created = (await createResponse.json()) as { id?: string };
      if (created.id) return { userId: created.id, password };
    }
  } else {
    const updateResponse = await supabaseRequest(`/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }, "service");
    if (updateResponse.ok) return { userId: existing.id, password };
  }

  const refreshed = await listSupabaseUsers();
  const user = refreshed.find((candidate) =>
    channel === "phone"
      ? candidate.phone === normalized || candidate.email === email
      : candidate.email?.toLowerCase() === email,
  );
  if (!user?.id) throw new Error("Unable to provision the Supabase identity.");
  const updateResponse = await supabaseRequest(`/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  }, "service");
  if (!updateResponse.ok) throw new Error("Unable to refresh the Supabase identity.");
  return { userId: user.id, password };
}

async function authenticateSupabaseCredential(
  channel: VerificationChannel,
  identifier: string,
  password: string,
) {
  if (!hasSupabaseAuthAccess()) return { kind: "not_configured" as const };
  const normalized = channel === "phone" ? normalizeBangladeshiPhone(identifier) : normalizeEmail(identifier);
  let email = normalized;

  if (channel === "phone") {
    if (!hasSupabaseServiceAccess()) return { kind: "phone_auth_disabled" as const };
    const user = (await listSupabaseUsers()).find(
      (candidate) => candidate.phone === normalized || candidate.email === phoneAliasEmail(normalized),
    );
    if (!user?.id) return { kind: "invalid_credentials" as const };
    email = user.email ?? phoneAliasEmail(normalized);
    if (!user.email) {
      const migrateResponse = await supabaseRequest(`/auth/v1/admin/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({
          email: phoneAliasEmail(normalized),
          email_confirm: true,
          password,
          user_metadata: { phone: normalized },
        }),
      }, "service");
      if (!migrateResponse.ok) return { kind: "invalid_credentials" as const };
      email = phoneAliasEmail(normalized);
    }
  }

  const response = await supabaseRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }, "anon");
  if (!response.ok) return { kind: "invalid_credentials" as const };
  const payload = (await response.json()) as { user?: { id?: string } };
  return payload.user?.id
    ? ({ kind: "authenticated" as const, userId: payload.user.id })
    : ({ kind: "invalid_credentials" as const });
}

export async function authenticateMemberWithPassword(
  identifier: string,
  password: string,
  channel: VerificationChannel = "phone",
) {
  const normalizedIdentifier = channel === "phone" ? normalizeBangladeshiPhone(identifier) : normalizeEmail(identifier);
  const result = await authenticateSupabaseCredential(channel, normalizedIdentifier, password);
  if (result.kind !== "authenticated") return result;
  const member = await findMemberByUserId(result.userId);
  if (!member) return { kind: "not_authorized" as const };
  return { kind: "authenticated" as const, member };
}

export async function authenticateAdminWithCredential(
  identifier: string,
  password: string,
  channel: VerificationChannel,
) {
  const normalizedIdentifier = channel === "phone"
    ? normalizeBangladeshiPhone(identifier)
    : normalizeEmail(identifier);
  const authorized = channel === "phone"
    ? isConfiguredAdminPhone(normalizedIdentifier)
    : isConfiguredAdminEmail(normalizedIdentifier);
  if (!authorized) return { kind: "not_authorized" as const };
  const result = await authenticateSupabaseCredential(channel, normalizedIdentifier, password);
  if (result.kind !== "authenticated") return result;
  const identity = await findAdminByUserId(result.userId);
  if (!identity) return { kind: "not_authorized" as const };
  return { kind: "authenticated" as const, identity };
}

export async function authenticateAdminWithPhone(phone: string, password: string) {
  return authenticateAdminWithCredential(phone, password, "phone");
}

async function requestOtpChallenge(
  channel: VerificationChannel,
  identifier: string,
  purpose: OtpPurpose,
  requestIp?: string | null,
) {
  const normalizedIdentifier =
    channel === "phone" ? normalizeBangladeshiPhone(identifier) : normalizeEmail(identifier);
  if (purpose === "admin_setup" && !(channel === "phone"
    ? isConfiguredAdminPhone(normalizedIdentifier)
    : isConfiguredAdminEmail(normalizedIdentifier))) {
    return { kind: "not_available" as const };
  }
  if (!process.env.SESSION_SECRET || !hasSupabaseServiceAccess() || !process.env.SMS_API_KEY) {
    return { kind: "not_configured" as const };
  }
  const now = new Date();
  const [recent] = await db
    .select({ requestedAt: otpChallengesTable.requestedAt })
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.channel, channel),
        eq(otpChallengesTable.identifier, normalizedIdentifier),
        eq(otpChallengesTable.purpose, purpose),
        gt(otpChallengesTable.requestedAt, new Date(now.getTime() - OTP_RESEND_SECONDS * 1000)),
        isNull(otpChallengesTable.consumedAt),
      ),
    )
    .orderBy(desc(otpChallengesTable.requestedAt))
    .limit(1);
  if (recent) return { kind: "cooldown" as const };

  const [{ requests }] = await db
    .select({ requests: count() })
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.channel, channel),
        eq(otpChallengesTable.identifier, normalizedIdentifier),
        eq(otpChallengesTable.purpose, purpose),
        gt(otpChallengesTable.requestedAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    );
  if (Number(requests) >= OTP_HOURLY_LIMIT) return { kind: "rate_limited" as const };

  await db
    .update(otpChallengesTable)
    .set({ consumedAt: now })
    .where(
      and(
        eq(otpChallengesTable.channel, channel),
        eq(otpChallengesTable.identifier, normalizedIdentifier),
        eq(otpChallengesTable.purpose, purpose),
        isNull(otpChallengesTable.consumedAt),
      ),
    );

  const otp = String(randomInt(100000, 1000000));
  await db.insert(otpChallengesTable).values({
    channel,
    identifier: normalizedIdentifier,
    purpose,
    otpHash: hashOtp(otp),
    expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
    requestIp: requestIp ?? null,
  });
  try {
    await sendOtpSms(normalizedIdentifier, otp);
  } catch (error) {
    await db
      .update(otpChallengesTable)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(otpChallengesTable.channel, channel),
          eq(otpChallengesTable.identifier, normalizedIdentifier),
          eq(otpChallengesTable.purpose, purpose),
          eq(otpChallengesTable.otpHash, hashOtp(otp)),
        ),
      );
    throw error;
  }
  return { kind: "sent" as const };
}

async function requestEmailOtp(
  email: string,
  purpose: OtpPurpose,
  requestIp?: string | null,
) {
  const normalizedEmail = normalizeEmail(email);
  if (purpose === "admin_setup" && !isConfiguredAdminEmail(normalizedEmail)) {
    return { kind: "not_available" as const };
  }
  if (!process.env.SESSION_SECRET || !hasSupabaseAuthAccess()) {
    return { kind: "not_configured" as const };
  }
  const now = new Date();
  const [recent] = await db
    .select({ requestedAt: otpChallengesTable.requestedAt })
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.channel, "email"),
        eq(otpChallengesTable.identifier, normalizedEmail),
        eq(otpChallengesTable.purpose, purpose),
        gt(otpChallengesTable.requestedAt, new Date(now.getTime() - OTP_RESEND_SECONDS * 1000)),
        isNull(otpChallengesTable.consumedAt),
      ),
    )
    .orderBy(desc(otpChallengesTable.requestedAt))
    .limit(1);
  if (recent) return { kind: "cooldown" as const };

  const [{ requests }] = await db
    .select({ requests: count() })
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.channel, "email"),
        eq(otpChallengesTable.identifier, normalizedEmail),
        eq(otpChallengesTable.purpose, purpose),
        gt(otpChallengesTable.requestedAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    );
  if (Number(requests) >= OTP_HOURLY_LIMIT) return { kind: "rate_limited" as const };

  await db
    .update(otpChallengesTable)
    .set({ consumedAt: now })
    .where(
      and(
        eq(otpChallengesTable.channel, "email"),
        eq(otpChallengesTable.identifier, normalizedEmail),
        eq(otpChallengesTable.purpose, purpose),
        isNull(otpChallengesTable.consumedAt),
      ),
    );

  const response = await supabaseRequest("/auth/v1/otp", {
    method: "POST",
    body: JSON.stringify({
      email: normalizedEmail,
      create_user: purpose !== "member_reset",
    }),
  }, "anon");
  if (!response.ok) {
    if (response.status === 429) return { kind: "rate_limited" as const };
    throw new Error("Unable to send the email verification code.");
  }

  await db.insert(otpChallengesTable).values({
    channel: "email",
    identifier: normalizedEmail,
    purpose,
    otpHash: hashOtp("supabase-email"),
    expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
    requestIp: requestIp ?? null,
  });
  return { kind: "sent" as const };
}

export async function requestMemberOtp(
  phone: string,
  purpose: OtpPurpose = "member_signup",
  requestIp?: string | null,
) {
  if (purpose === "admin_setup") return { kind: "not_available" as const };
  return requestOtpChallenge("phone", phone, purpose, requestIp);
}

export async function requestMemberEmailOtp(
  email: string,
  purpose: "member_signup" | "member_reset",
  requestIp?: string | null,
) {
  return requestEmailOtp(email, purpose, requestIp);
}

export async function requestAdminOtp(phone: string, requestIp?: string | null) {
  return requestOtpChallenge("phone", phone, "admin_setup", requestIp);
}

export async function requestAdminEmailOtp(email: string, requestIp?: string | null) {
  return requestEmailOtp(email, "admin_setup", requestIp);
}

async function createVerification(challenge: typeof otpChallengesTable.$inferSelect) {
  const verificationToken = createVerificationToken();
  await db
    .update(otpChallengesTable)
    .set({
      verificationTokenHash: hashVerificationToken(verificationToken),
      verificationExpiresAt: new Date(Date.now() + VERIFICATION_TOKEN_SECONDS * 1000),
    })
    .where(eq(otpChallengesTable.id, challenge.id));
  return { kind: "verified" as const, verificationToken, identifier: challenge.identifier, purpose: challenge.purpose };
}

export async function verifyOtp(phone: string, otp: string, purpose: OtpPurpose) {
  const normalizedPhone = normalizeBangladeshiPhone(phone);
  if (purpose === "admin_setup" && !isConfiguredAdminPhone(normalizedPhone)) {
    return { kind: "invalid" as const };
  }
  if (!/^\d{6}$/.test(otp)) return { kind: "invalid" as const };
  const [challenge] = await db
    .select()
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.channel, "phone"),
        eq(otpChallengesTable.identifier, normalizedPhone),
        eq(otpChallengesTable.purpose, purpose),
        isNull(otpChallengesTable.consumedAt),
        gt(otpChallengesTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(otpChallengesTable.requestedAt))
    .limit(1);
  if (!challenge || challenge.attempts >= OTP_MAX_ATTEMPTS) return { kind: "invalid" as const };

  const matches = hashOtp(otp) === challenge.otpHash;
  await db
    .update(otpChallengesTable)
    .set({ attempts: challenge.attempts + 1, consumedAt: matches ? new Date() : undefined })
    .where(eq(otpChallengesTable.id, challenge.id));
  if (!matches) return { kind: "invalid" as const };
  return createVerification(challenge);
}

export async function verifyEmailOtp(email: string, otp: string, purpose: OtpPurpose) {
  const normalizedEmail = normalizeEmail(email);
  if (purpose === "admin_setup" && !isConfiguredAdminEmail(normalizedEmail)) {
    return { kind: "invalid" as const };
  }
  if (!/^\d{6}$/.test(otp)) return { kind: "invalid" as const };
  const [challenge] = await db
    .select()
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.channel, "email"),
        eq(otpChallengesTable.identifier, normalizedEmail),
        eq(otpChallengesTable.purpose, purpose),
        isNull(otpChallengesTable.consumedAt),
        gt(otpChallengesTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(otpChallengesTable.requestedAt))
    .limit(1);
  if (!challenge || challenge.attempts >= OTP_MAX_ATTEMPTS) return { kind: "invalid" as const };

  const response = await supabaseRequest("/auth/v1/verify", {
    method: "POST",
    body: JSON.stringify({ type: "email", email: normalizedEmail, token: otp }),
  }, "anon");
  const matches = response.ok;
  await db
    .update(otpChallengesTable)
    .set({ attempts: challenge.attempts + 1, consumedAt: matches ? new Date() : undefined })
    .where(eq(otpChallengesTable.id, challenge.id));
  if (!matches) return { kind: "invalid" as const };
  return createVerification(challenge);
}

async function consumeVerification(
  channel: VerificationChannel,
  identifier: string,
  purpose: OtpPurpose,
  verificationToken: string,
) {
  const normalizedIdentifier =
    channel === "phone" ? normalizeBangladeshiPhone(identifier) : normalizeEmail(identifier);
  const [challenge] = await db
    .select()
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.channel, channel),
        eq(otpChallengesTable.identifier, normalizedIdentifier),
        eq(otpChallengesTable.purpose, purpose),
        eq(otpChallengesTable.verificationTokenHash, hashVerificationToken(verificationToken)),
        gt(otpChallengesTable.verificationExpiresAt, new Date()),
        isNull(otpChallengesTable.verificationConsumedAt),
      ),
    )
    .orderBy(desc(otpChallengesTable.requestedAt))
    .limit(1);
  if (!challenge || !challenge.verificationTokenHash || !safeTokenMatch(challenge.verificationTokenHash, hashVerificationToken(verificationToken))) {
    return null;
  }
  await db
    .update(otpChallengesTable)
    .set({ verificationConsumedAt: new Date() })
    .where(eq(otpChallengesTable.id, challenge.id));
  return normalizedIdentifier;
}

async function upsertMemberProfile(
  userId: string,
  profile: { phone?: string; email?: string; name?: string },
) {
  let [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.authUserId, userId))
    .limit(1);
  if (!member && profile.phone) {
    [member] = await db.select().from(membersTable).where(eq(membersTable.phone, profile.phone)).limit(1);
  }
  if (!member && profile.email) {
    [member] = await db.select().from(membersTable).where(eq(membersTable.email, profile.email)).limit(1);
  }
  if (!member) {
    [member] = await db.insert(membersTable).values({
      authUserId: userId,
      name: profile.name ?? "New member",
      phone: profile.phone ?? null,
      email: profile.email ?? null,
      university: "Other",
    }).returning();
  } else if (!member.authUserId) {
    [member] = await db
      .update(membersTable)
      .set({
        authUserId: userId,
        ...(profile.phone ? { phone: profile.phone } : {}),
        ...(profile.email ? { email: profile.email } : {}),
        ...(profile.name && member.name === "New member" ? { name: profile.name } : {}),
        updatedAt: new Date(),
      })
      .where(eq(membersTable.id, member.id))
      .returning();
  }
  if (!member) throw new Error("Unable to create the member profile.");
  return member;
}

export async function setMemberPassword(
  identifier: string,
  password: string,
  verificationToken: string,
  purpose: "member_signup" | "member_reset",
  channel: VerificationChannel = "phone",
) {
  if (password.length < 8) return { kind: "invalid_password" as const };
  const normalizedIdentifier = await consumeVerification(channel, identifier, purpose, verificationToken);
  if (!normalizedIdentifier) return { kind: "invalid_verification" as const };
  const existing = await db
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(channel === "phone" ? eq(membersTable.phone, normalizedIdentifier) : eq(membersTable.email, normalizedIdentifier))
    .limit(1);
  if (purpose === "member_signup" && existing.length > 0) return { kind: "already_registered" as const };
  if (purpose === "member_reset" && existing.length === 0) return { kind: "not_found" as const };

  const { userId } = await ensureSupabaseCredentialUser(channel, normalizedIdentifier, password);
  const member = await upsertMemberProfile(userId, channel === "phone" ? { phone: normalizedIdentifier } : { email: normalizedIdentifier });
  return { kind: "updated" as const, member };
}

export async function setAdminPassword(
  identifier: string,
  password: string,
  verificationToken: string,
  channel: VerificationChannel = "phone",
) {
  if (password.length < 8) return { kind: "invalid_password" as const };
  const normalizedIdentifier = await consumeVerification(channel, identifier, "admin_setup", verificationToken);
  const authorized = normalizedIdentifier && (channel === "phone"
    ? isConfiguredAdminPhone(normalizedIdentifier)
    : isConfiguredAdminEmail(normalizedIdentifier));
  if (!normalizedIdentifier || !authorized) {
    return { kind: "invalid_verification" as const };
  }
  const { userId } = await ensureSupabaseCredentialUser(channel, normalizedIdentifier, password);
  const memberMatch = channel === "phone"
    ? eq(membersTable.phone, normalizedIdentifier)
    : eq(membersTable.email, normalizedIdentifier);
  let [member] = await db
    .select()
    .from(membersTable)
    .where(memberMatch)
    .limit(1);
  if (!member) {
    [member] = await db.insert(membersTable).values({
      authUserId: userId,
      name: "Undergraduate Hub administrator",
      ...(channel === "phone" ? { phone: normalizedIdentifier } : { email: normalizedIdentifier }),
      university: "Undergraduate Hub",
      role: "admin",
    }).returning();
  } else {
    [member] = await db.update(membersTable).set({
      authUserId: userId,
      role: "admin",
      status: "active",
      updatedAt: new Date(),
    }).where(eq(membersTable.id, member.id)).returning();
  }
  await db.insert(userRolesTable).values({ userId, role: "admin", createdBy: userId }).onConflictDoNothing();
  return { kind: "updated" as const, member };
}

export async function verifyMemberOtp(phone: string, otp: string, purpose: "member_signup" | "member_reset" = "member_signup") {
  return verifyOtp(phone, otp, purpose);
}

export async function verifyMemberEmailOtp(email: string, otp: string, purpose: "member_signup" | "member_reset" = "member_signup") {
  return verifyEmailOtp(email, otp, purpose);
}

export async function loginMember(identifier: string, password: string, channel: VerificationChannel = "phone") {
  const result = await authenticateMemberWithPassword(identifier, password, channel);
  if (result.kind !== "authenticated") return result;
  const session = await createMemberSession(result.member.userId, result.member.memberId);
  return { kind: "authenticated" as const, member: result.member, session };
}

export async function loginMemberWithGoogleAccessToken(accessToken: string) {
  if (!hasSupabaseAuthAccess()) return { kind: "not_configured" as const };
  if (!accessToken || accessToken.length > 8192) {
    return { kind: "invalid_credentials" as const };
  }

  const response = await supabaseRequest("/auth/v1/user", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  }, "anon");
  if (!response.ok) return { kind: "invalid_credentials" as const };

  const user = (await response.json()) as {
    id?: string;
    email?: string;
    user_metadata?: { full_name?: unknown; name?: unknown; phone?: unknown };
    app_metadata?: { provider?: unknown; providers?: unknown };
  };
  const userId = user.id;
  const provider = user.app_metadata?.provider;
  const providers = user.app_metadata?.providers;
  if (!userId || (provider !== "google" && (!Array.isArray(providers) || !providers.includes("google")))) {
    return { kind: "not_authorized" as const };
  }

  let email: string | undefined;
  try {
    if (typeof user.email === "string" && user.email.trim()) {
      email = normalizeEmail(user.email);
    }
  } catch {
    return { kind: "invalid_credentials" as const };
  }

  const metadataName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : undefined;
  const name = metadataName?.trim().slice(0, 160) || undefined;
  const profile = await upsertMemberProfile(userId, { email, name });
  if (profile.authUserId !== userId) return { kind: "not_authorized" as const };

  const member = await findMemberByUserId(userId);
  if (!member) return { kind: "not_authorized" as const };
  const session = await createMemberSession(member.userId, member.memberId);
  return { kind: "authenticated" as const, member, session };
}

export async function loginAdmin(phone: string, password: string) {
  return authenticateAdminWithPhone(phone, password);
}
