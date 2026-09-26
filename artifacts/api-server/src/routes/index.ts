import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import libraryRouter from "./library";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(libraryRouter);

export default router;
