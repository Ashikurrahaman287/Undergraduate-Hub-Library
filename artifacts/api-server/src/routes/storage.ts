import { Readable } from "node:stream";
import { Router, type IRouter } from "express";
import { getAuthenticatedAdmin, getAuthenticatedMember } from "../auth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/object-storage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

async function isAuthenticated(req: Parameters<typeof getAuthenticatedMember>[0]) {
  const [member, admin] = await Promise.all([getAuthenticatedMember(req), getAuthenticatedAdmin(req)]);
  return Boolean(member || admin);
}

router.post("/storage/uploads/request-url", async (req, res, next) => {
  try {
    if (!(await isAuthenticated(req))) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const { name, size, contentType } = req.body ?? {};
    if (typeof name !== "string" || typeof size !== "number" || size <= 0 || size > 5_000_000 || typeof contentType !== "string" || !contentType.startsWith("image/")) {
      res.status(400).json({ error: "Upload an image smaller than 5 MB." });
      return;
    }
    const result = await storage.uploadUrl();
    res.json({ ...result, metadata: { name, size, contentType } });
  } catch (error) {
    next(error);
  }
});

router.get("/storage/objects/*path", async (req, res, next) => {
  try {
    if (!(await isAuthenticated(req))) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const raw = req.params.path;
    const path = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`;
    const file = await storage.file(path);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", String(metadata.contentType ?? "application/octet-stream"));
    res.setHeader("Cache-Control", "private, max-age=3600");
    Readable.from(file.createReadStream()).pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Screenshot not found." });
      return;
    }
    next(error);
  }
});

export default router;