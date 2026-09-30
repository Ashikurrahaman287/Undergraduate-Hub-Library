import { Router, type IRouter } from "express";
import authRouter from "./auth.js";
import healthRouter from "./health.js";
import libraryRouter from "./library.js";
import storageRouter from "./storage.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(libraryRouter);
router.use(storageRouter);

export default router;
