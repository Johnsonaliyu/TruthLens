import { Router, type IRouter } from "express";
import healthRouter from "./health";
import truthlensRouter from "./truthlens";

const router: IRouter = Router();

router.use(healthRouter);
router.use(truthlensRouter);

export default router;
