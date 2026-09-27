import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import libraryRouter from "./library";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(libraryRouter);
router.use(storageRouter);

export default router;
