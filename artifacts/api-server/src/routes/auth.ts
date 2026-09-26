import { Router, type IRouter } from "express";
import {
  adminSessionResponse,
  authenticateAdminWithCredential,
  clearAdminSessionCookie,
  createAdminSession,
  clearMemberSessionCookie,
  getAuthenticatedMember,
  getAuthenticatedAdmin,
  loginMember,
  memberSessionResponse,
  requestAdminOtp,
  requestAdminEmailOtp,
  requestMemberOtp,
  requestMemberEmailOtp,
  requestAdminPasswordReset,
  revokeAdminSession,
  revokeMemberSession,
  setAdminSessionCookie,
  setMemberSessionCookie,
  setAdminPassword,
  setMemberPassword,
  updateAdminPassword,
  verifyOtp,
  verifyEmailOtp,
  verifyMemberOtp,
  verifyMemberEmailOtp,
} from "../auth";

const router: IRouter = Router();

router.post("/auth/admin/login", async (request, response, next) => {
  try {
    const body = request.body ?? {};
    const channel = body.channel === "email" ? ("email" as const) : ("phone" as const);
    const identifier =
      typeof body.identifier === "string"
        ? body.identifier
        : channel === "email"
          ? body.email
          : body.phone;
    const password = typeof body.password === "string" ? body.password : "";
    if (typeof identifier !== "string" || !password) {
      response.status(400).json({ error: "Enter your email or mobile number and password." });
      return;
    }
    const result = await authenticateAdminWithCredential(identifier, password, channel);
    if (result.kind === "not_configured") {
      response.status(503).json({ error: "Administrator authentication is not configured." });
      return;
    }
    if (result.kind !== "authenticated") {
      response.status(result.kind === "not_authorized" ? 403 : 401).json({
        error: result.kind === "not_authorized"
          ? "This account is not authorized for the Admin Panel."
          : "Invalid administrator credentials.",
      });
      return;
    }

    const session = await createAdminSession(result.identity.userId, body.rememberSession ?? false);
    setAdminSessionCookie(response, session.token, session.expiresAt);
    response.json(adminSessionResponse(result.identity));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/request-otp", async (request, response, next) => {
  try {
    const channel = request.body?.channel === "email" ? ("email" as const) : ("phone" as const);
    const identifier =
      typeof request.body?.identifier === "string"
        ? request.body.identifier
        : channel === "email"
          ? request.body?.email
          : request.body?.phone;
    const result = channel === "email"
      ? await requestAdminEmailOtp(typeof identifier === "string" ? identifier : "", request.ip)
      : await requestAdminOtp(typeof identifier === "string" ? identifier : "", request.ip);
    if (result.kind === "not_configured") {
      response.status(503).json({ error: "Administrator verification is not configured." });
      return;
    }
    if (result.kind === "not_available") {
      response.status(403).json({ error: "This contact is not configured for administrator setup." });
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
    response.status(202).json({ message: "A verification code has been sent." });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/verify-otp", async (request, response, next) => {
  try {
    const channel = request.body?.channel === "email" ? ("email" as const) : ("phone" as const);
    const identifier =
      typeof request.body?.identifier === "string"
        ? request.body.identifier
        : channel === "email"
          ? request.body?.email
          : request.body?.phone;
    const otp = typeof request.body?.otp === "string" ? request.body.otp : "";
    const result = channel === "email"
      ? await verifyEmailOtp(typeof identifier === "string" ? identifier : "", otp, "admin_setup")
      : await verifyOtp(typeof identifier === "string" ? identifier : "", otp, "admin_setup");
    if (result.kind !== "verified") {
      response.status(401).json({ error: "The verification code is invalid or expired." });
      return;
    }
    response.json({ verified: true, verificationToken: result.verificationToken });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/admin/set-password", async (request, response, next) => {
  try {
    const channel = request.body?.channel === "email" ? ("email" as const) : ("phone" as const);
    const identifier =
      typeof request.body?.identifier === "string"
        ? request.body.identifier
        : channel === "email"
          ? request.body?.email
          : request.body?.phone;
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const verificationToken =
      typeof request.body?.verificationToken === "string" ? request.body.verificationToken : "";
    const result = await setAdminPassword(typeof identifier === "string" ? identifier : "", password, verificationToken, channel);
    if (result.kind === "invalid_password") {
      response.status(400).json({ error: "Password must be at least 8 characters." });
      return;
    }
    if (result.kind !== "updated") {
      response.status(401).json({ error: "The OTP verification is invalid or expired." });
      return;
    }
    response.json({ message: "Administrator password created. You can now sign in." });
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

router.post("/auth/member/login", async (request, response, next) => {
  try {
    const channel = request.body?.channel === "email" ? ("email" as const) : ("phone" as const);
    const identifier =
      typeof request.body?.identifier === "string"
        ? request.body.identifier
        : channel === "email"
          ? request.body?.email
          : request.body?.phone;
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const result = await loginMember(typeof identifier === "string" ? identifier : "", password, channel);
    if (result.kind === "not_configured") {
      response.status(503).json({ error: "Member authentication is not configured." });
      return;
    }
    if (result.kind !== "authenticated") {
      response.status(401).json({ error: "Invalid mobile number or password." });
      return;
    }
    setMemberSessionCookie(response, result.session.token, result.session.expiresAt);
    response.json(memberSessionResponse(result.member));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/member/request-otp", async (request, response, next) => {
  try {
    const channel = request.body?.channel === "email" ? ("email" as const) : ("phone" as const);
    const identifier =
      typeof request.body?.identifier === "string"
        ? request.body.identifier
        : channel === "email"
          ? request.body?.email
          : request.body?.phone;
    const purpose =
      request.body?.purpose === "member_reset" ? ("member_reset" as const) : ("member_signup" as const);
    const result = channel === "email"
      ? await requestMemberEmailOtp(typeof identifier === "string" ? identifier : "", purpose, request.ip)
      : await requestMemberOtp(typeof identifier === "string" ? identifier : "", purpose, request.ip);
    if (result.kind === "not_configured") {
      response.status(503).json({ error: "Member verification is not configured." });
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
    const channel = request.body?.channel === "email" ? ("email" as const) : ("phone" as const);
    const identifier =
      typeof request.body?.identifier === "string"
        ? request.body.identifier
        : channel === "email"
          ? request.body?.email
          : request.body?.phone;
    const otp = typeof request.body?.otp === "string" ? request.body.otp : "";
    const purpose =
      request.body?.purpose === "member_reset" ? ("member_reset" as const) : ("member_signup" as const);
    const result = channel === "email"
      ? await verifyMemberEmailOtp(typeof identifier === "string" ? identifier : "", otp, purpose)
      : await verifyMemberOtp(typeof identifier === "string" ? identifier : "", otp, purpose);
    if (result.kind !== "verified") {
      response.status(401).json({ error: "The verification code is invalid or expired." });
      return;
    }
    response.json({ verified: true, verificationToken: result.verificationToken });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/member/set-password", async (request, response, next) => {
  try {
    const channel = request.body?.channel === "email" ? ("email" as const) : ("phone" as const);
    const identifier =
      typeof request.body?.identifier === "string"
        ? request.body.identifier
        : channel === "email"
          ? request.body?.email
          : request.body?.phone;
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const verificationToken =
      typeof request.body?.verificationToken === "string" ? request.body.verificationToken : "";
    const purpose =
      request.body?.purpose === "member_reset" ? ("member_reset" as const) : ("member_signup" as const);
    const result = await setMemberPassword(typeof identifier === "string" ? identifier : "", password, verificationToken, purpose, channel);
    if (result.kind === "invalid_password") {
      response.status(400).json({ error: "Password must be at least 8 characters." });
      return;
    }
    if (result.kind === "already_registered") {
      response.status(409).json({ error: "This contact already has an account. Use Forgot password instead." });
      return;
    }
    if (result.kind === "not_found") {
      response.status(404).json({ error: "No member account was found for this contact." });
      return;
    }
    if (result.kind !== "updated") {
      response.status(401).json({ error: "The OTP verification is invalid or expired." });
      return;
    }
    if (purpose === "member_signup") {
      response.json({ message: "Account created. You can now sign in." });
      return;
    }
    response.json({ message: "Password updated. You can now sign in." });
  } catch (error) {
    next(error);
  }
});

export default router;