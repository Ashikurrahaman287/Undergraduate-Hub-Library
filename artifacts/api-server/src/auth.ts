import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, count, desc, eq, gt, isNull, lt } from "drizzle-orm";
import {
  adminSessionsTable,
  db,
  memberSessionsTable,
  membersTable,
  otpChallengesTable,
  userRolesTable,
} from "@workspace/db";
import { sendOtpSms } from "./services/sms";

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

function configuredAdminPhone() {
  const value = process.env.ADMIN_PHONE_NUMBER;
  if (!value) throw new Error("ADMIN_PHONE_NUMBER is not configured.");
  return normalizeBangladeshiPhone(value);
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

export function normalizeBangladeshiPhone(value: string) {
  const compact = value.replace(/[\s()-]/g, "");
  const local = compact.startsWith("+880")
    ? `0${compact.slice(4)}`
    : compact.startsWith("880")
      ? `0${compact.slice(3)}`
      : compact;
  if (!/^01[3-9]\d{8}$/.test(local)) {
    throw new Error("Enter a valid Bangladeshi mobile number.");
  }
  return `+880${local.slice(1)}`;
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

async function findMemberByUserId(userId: string): Promise<MemberIdentity | null> {
  const [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.authUserId, userId))
    .limit(1);
  if (!member || member.status !== "active") return null;
  return { userId, memberId: member.id, phone: member.phone, name: member.name };
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

export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}

export async function requestAdminPasswordReset(email: string) {
  const config = getSupabaseConfig();
  if (!config) return { kind: "not_configured" as const };

  const redirectTo = process.env.ADMIN_PASSWORD_RESET_REDIRECT_URL;
  const response = await fetch(`${config.url}/auth/v1/recover`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      ...(redirectTo ? { redirect_to: redirectTo } : {}),
    }),
  });
  if (!response.ok && response.status !== 400) {
    throw new Error("Unable to start password recovery.");
  }
  return { kind: "accepted" as const };
}

export async function updateAdminPassword(accessToken: string, password: string) {
  const config = getSupabaseConfig();
  if (!config) return { kind: "not_configured" as const };

  const response = await fetch(`${config.url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  return response.ok
    ? ({ kind: "updated" as const })
    : ({ kind: "invalid_or_expired_token" as const });
}

async function ensureSupabasePhoneUser(phone: string, password: string) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase authentication is not configured.");
  const createResponse = await fetch(`${config.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phone,
      password,
      phone_confirm: true,
      user_metadata: { phone },
    }),
  });

  if (createResponse.ok) {
    const created = (await createResponse.json()) as { id?: string };
    if (created.id) return { userId: created.id, password };
  }

  const listResponse = await fetch(`${config.url}/auth/v1/admin/users?per_page=1000&page=1`, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
    },
  });
  if (!listResponse.ok) throw new Error("Unable to load Supabase user records.");
  const payload = (await listResponse.json()) as { users?: Array<{ id?: string; phone?: string }> };
  const user = payload.users?.find((candidate) => candidate.phone === phone);
  if (!user?.id) throw new Error("Unable to provision the Supabase phone identity.");

  const updateResponse = await fetch(`${config.url}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password, phone_confirm: true }),
  });
  if (!updateResponse.ok) throw new Error("Unable to refresh the Supabase phone identity.");
  return { userId: user.id, password };
}

async function authenticateSupabasePhone(phone: string, password: string) {
  const config = getSupabaseConfig();
  if (!config) return { kind: "not_configured" as const };
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone, password }),
  });
  if (!response.ok) return { kind: "invalid_credentials" as const };
  const payload = (await response.json()) as { user?: { id?: string } };
  return payload.user?.id
    ? ({ kind: "authenticated" as const, userId: payload.user.id })
    : ({ kind: "invalid_credentials" as const });
}

export async function authenticateMemberWithPassword(phone: string, password: string) {
  const normalizedPhone = normalizeBangladeshiPhone(phone);
  const result = await authenticateSupabasePhone(normalizedPhone, password);
  if (result.kind !== "authenticated") return result;
  const member = await findMemberByUserId(result.userId);
  if (!member) return { kind: "not_authorized" as const };
  return { kind: "authenticated" as const, member };
}

export async function authenticateAdminWithPhone(phone: string, password: string) {
  const normalizedPhone = normalizeBangladeshiPhone(phone);
  const result = await authenticateSupabasePhone(normalizedPhone, password);
  if (result.kind !== "authenticated") return result;
  const identity = await findAdminByUserId(result.userId);
  if (!identity) return { kind: "not_authorized" as const };
  return { kind: "authenticated" as const, identity };
}

async function requestOtpChallenge(
  phone: string,
  purpose: OtpPurpose,
  requestIp?: string | null,
) {
  const normalizedPhone = normalizeBangladeshiPhone(phone);
  if (!process.env.SESSION_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SMS_API_KEY) {
    return { kind: "not_configured" as const };
  }
  if (purpose === "admin_setup" && normalizedPhone !== configuredAdminPhone()) {
    return { kind: "not_available" as const };
  }
  const now = new Date();
  const [recent] = await db
    .select({ requestedAt: otpChallengesTable.requestedAt })
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.phone, normalizedPhone),
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
        eq(otpChallengesTable.phone, normalizedPhone),
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
        eq(otpChallengesTable.phone, normalizedPhone),
        eq(otpChallengesTable.purpose, purpose),
        isNull(otpChallengesTable.consumedAt),
      ),
    );

  const otp = String(randomInt(100000, 1000000));
  await db.insert(otpChallengesTable).values({
    phone: normalizedPhone,
    purpose,
    otpHash: hashOtp(otp),
    expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
    requestIp: requestIp ?? null,
  });
  try {
    await sendOtpSms(normalizedPhone, otp);
  } catch (error) {
    await db
      .update(otpChallengesTable)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(otpChallengesTable.phone, normalizedPhone),
          eq(otpChallengesTable.purpose, purpose),
          eq(otpChallengesTable.otpHash, hashOtp(otp)),
        ),
      );
    throw error;
  }
  return { kind: "sent" as const };
}

export async function requestMemberOtp(
  phone: string,
  purpose: OtpPurpose = "member_signup",
  requestIp?: string | null,
) {
  if (purpose === "admin_setup") return { kind: "not_available" as const };
  return requestOtpChallenge(phone, purpose, requestIp);
}

export async function requestAdminOtp(phone: string, requestIp?: string | null) {
  return requestOtpChallenge(phone, "admin_setup", requestIp);
}

export async function verifyOtp(phone: string, otp: string, purpose: OtpPurpose) {
  const normalizedPhone = normalizeBangladeshiPhone(phone);
  if (purpose === "admin_setup" && normalizedPhone !== configuredAdminPhone()) {
    return { kind: "invalid" as const };
  }
  if (!/^\d{6}$/.test(otp)) return { kind: "invalid" as const };
  const [challenge] = await db
    .select()
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.phone, normalizedPhone),
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

  const verificationToken = createVerificationToken();
  await db
    .update(otpChallengesTable)
    .set({
      verificationTokenHash: hashVerificationToken(verificationToken),
      verificationExpiresAt: new Date(Date.now() + VERIFICATION_TOKEN_SECONDS * 1000),
    })
    .where(eq(otpChallengesTable.id, challenge.id));
  return { kind: "verified" as const, verificationToken, phone: normalizedPhone, purpose };
}

async function consumeVerification(phone: string, purpose: OtpPurpose, verificationToken: string) {
  const normalizedPhone = normalizeBangladeshiPhone(phone);
  const [challenge] = await db
    .select()
    .from(otpChallengesTable)
    .where(
      and(
        eq(otpChallengesTable.phone, normalizedPhone),
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
  return normalizedPhone;
}

async function upsertMemberProfile(userId: string, phone: string) {
  let [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.authUserId, userId))
    .limit(1);
  if (!member) [member] = await db.insert(membersTable).values({
    authUserId: userId,
    name: "New member",
    phone,
    university: "Other",
  }).onConflictDoNothing({ target: membersTable.phone }).returning();
  if (!member) {
    [member] = await db.select().from(membersTable).where(eq(membersTable.phone, phone)).limit(1);
  }
  if (!member) throw new Error("Unable to create the member profile.");
  if (!member.authUserId) {
    [member] = await db
      .update(membersTable)
      .set({ authUserId: userId, updatedAt: new Date() })
      .where(eq(membersTable.id, member.id))
      .returning();
  }
  return member;
}

export async function setMemberPassword(
  phone: string,
  password: string,
  verificationToken: string,
  purpose: "member_signup" | "member_reset",
) {
  if (password.length < 8) return { kind: "invalid_password" as const };
  const normalizedPhone = await consumeVerification(phone, purpose, verificationToken);
  if (!normalizedPhone) return { kind: "invalid_verification" as const };
  const existing = await db
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(eq(membersTable.phone, normalizedPhone))
    .limit(1);
  if (purpose === "member_signup" && existing.length > 0) return { kind: "already_registered" as const };
  if (purpose === "member_reset" && existing.length === 0) return { kind: "not_found" as const };

  const { userId } = await ensureSupabasePhoneUser(normalizedPhone, password);
  const member = await upsertMemberProfile(userId, normalizedPhone);
  return { kind: "updated" as const, member };
}

export async function setAdminPassword(phone: string, password: string, verificationToken: string) {
  if (password.length < 8) return { kind: "invalid_password" as const };
  const normalizedPhone = await consumeVerification(phone, "admin_setup", verificationToken);
  if (!normalizedPhone || normalizedPhone !== configuredAdminPhone()) {
    return { kind: "invalid_verification" as const };
  }
  const { userId } = await ensureSupabasePhoneUser(normalizedPhone, password);
  let [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.phone, normalizedPhone))
    .limit(1);
  if (!member) {
    [member] = await db.insert(membersTable).values({
      authUserId: userId,
      name: "Undergraduate Hub administrator",
      phone: normalizedPhone,
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

export async function loginMember(phone: string, password: string) {
  const result = await authenticateMemberWithPassword(phone, password);
  if (result.kind !== "authenticated") return result;
  const session = await createMemberSession(result.member.userId, result.member.memberId);
  return { kind: "authenticated" as const, member: result.member, session };
}

export async function loginAdmin(phone: string, password: string) {
  return authenticateAdminWithPhone(phone, password);
}
