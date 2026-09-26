import { Router, type IRouter } from "express";
import { AdminLoginBody } from "@workspace/api-zod";
import {
  adminSessionResponse,
  authenticateAdminWithSupabase,
  clearAdminSessionCookie,
  createAdminSession,
  clearMemberSessionCookie,
  getAuthenticatedMember,
  getAuthenticatedAdmin,
  memberSessionResponse,
  requestMemberOtp,
  requestAdminPasswordReset,
  revokeAdminSession,
  revokeMemberSession,
  setAdminSessionCookie,
  setMemberSessionCookie,
  updateAdminPassword,
  verifyMemberOtp,
} from "../auth";

const router: IRouter = Router();

router.post("/auth/admin/login", async (request, response, next) => {
  try {
    const body = AdminLoginBody.parse(request.body);
    const result = await authenticateAdminWithSupabase(body.email, body.password);
    if (result.kind === "not_configured") {
      response.status(503).json({ error: "Administrator authentication is not configured." });
      return;
    }
    if (result.kind === "invalid_credentials") {
      response.status(401).json({ error: "Invalid administrator credentials." });
      return;
    }
    if (result.kind === "not_authorized") {
      response.status(403).json({ error: "This account is not authorized for the Admin Panel." });
      return;
    }

    const session = await createAdminSession(result.identity.userId, body.rememberSession ?? false);
    setAdminSessionCookie(response, session.token, session.expiresAt);
    response.json(adminSessionResponse(result.identity));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/forgot-password", async (request, response, next) => {
  try {
    const email = typeof request.body?.email === "string" ? request.body.email.trim() : "";
    if (!email || !email.includes("@")) {
      response.status(400).json({ error: "Enter a valid email address." });
      return;
    }
    const result = await requestAdminPasswordReset(email);
    if (result.kind === "not_configured") {
      response.status(503).json({ error: "Administrator authentication is not configured." });
      return;
    }
    // Do not reveal whether the account exists.
    response.status(202).json({
      message: "If an administrator account exists, recovery instructions have been sent.",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/reset-password", async (request, response, next) => {
  try {
    const accessToken =
      typeof request.body?.accessToken === "string" ? request.body.accessToken : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!accessToken || password.length < 12) {
      response.status(400).json({ error: "The recovery link or password is invalid." });
      return;
    }
    const result = await updateAdminPassword(accessToken, password);
    if (result.kind === "not_configured") {
      response.status(503).json({ error: "Administrator authentication is not configured." });
      return;
    }
    if (result.kind !== "updated") {
      response.status(400).json({ error: "The recovery link is invalid or has expired." });
      return;
    }
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/auth/admin/session", async (request, response, next) => {
  try {
    response.json(adminSessionResponse(await getAuthenticatedAdmin(request)));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/logout", async (request, response, next) => {
  try {
    await revokeAdminSession(request);
    await revokeMemberSession(request);
    clearAdminSessionCookie(response);
    clearMemberSessionCookie(response);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.get("/auth/member/session", async (request, response, next) => {
  try {
    const member = await getAuthenticatedMember(request);
    response.json({
      authenticated: Boolean(member),
      user: member ? { name: member.name, phone: member.phone } : null,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/member/request-otp", async (request, response, next) => {
  try {
    const phone = typeof request.body?.phone === "string" ? request.body.phone : "";
    const result = await requestMemberOtp(phone, request.ip);
    if (result.kind === "not_configured") {
      response.status(503).json({ error: "Member phone authentication is not configured." });
      return;
    }
    if (result.kind === "cooldown") {
      response.status(429).json({ error: "Please wait before requesting another code." });
      return;
    }
    if (result.kind === "rate_limited") {
      response.status(429).json({ error: "Too many requests. Try again later." });
      return;
    }
    response.status(202).json({ message: "If eligible, a verification code has been sent." });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/member/verify-otp", async (request, response, next) => {
  try {
    const phone = typeof request.body?.phone === "string" ? request.body.phone : "";
    const otp = typeof request.body?.otp === "string" ? request.body.otp : "";
    const result = await verifyMemberOtp(phone, otp);
    if (result.kind !== "authenticated") {
      response.status(401).json({ error: "The verification code is invalid or expired." });
      return;
    }
    setMemberSessionCookie(response, result.session.token, result.session.expiresAt);
    response.json(memberSessionResponse(result.member ? {
      userId: result.member.authUserId ?? "",
      memberId: result.member.id,
      phone: result.member.phone,
      name: result.member.name,
    } : null));
  } catch (error) {
    next(error);
  }
});

export default router;