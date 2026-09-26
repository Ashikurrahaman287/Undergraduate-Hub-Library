import { Router, type IRouter } from "express";
import { AdminLoginBody } from "@workspace/api-zod";
import {
  adminSessionResponse,
  authenticateAdminWithSupabase,
  clearAdminSessionCookie,
  createAdminSession,
  getAuthenticatedAdmin,
  revokeAdminSession,
  setAdminSessionCookie,
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
    clearAdminSessionCookie(response);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;