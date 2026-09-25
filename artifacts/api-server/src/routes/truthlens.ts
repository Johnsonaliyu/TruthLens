import { Router, type IRouter } from "express";
import {
  CreateVerificationBody,
  GetDashboardSummaryResponse,
  GetWhatsappQrResponse,
  GetWhatsappStatusResponse,
  ListVerificationsQueryParams,
  ListVerificationsResponse,
  StartWhatsappSessionResponse,
  DisconnectWhatsappSessionResponse,
  CreateVerificationResponse,
} from "@workspace/api-zod";
import {
  disconnectWhatsappSession,
  getWhatsappStatus,
  startWhatsappSession,
} from "../services/whatsapp";
import {
  getSummary,
  listVerifications,
  verifyClaim,
} from "../services/verification";

const router: IRouter = Router();

router.get("/dashboard/summary", (_req, res) => {
  res.json(GetDashboardSummaryResponse.parse(getSummary(getWhatsappStatus())));
});

router.get("/whatsapp/status", (_req, res) => {
  res.json(GetWhatsappStatusResponse.parse(getWhatsappStatus()));
});

router.post("/whatsapp/session/start", (_req, res) => {
  res.json(StartWhatsappSessionResponse.parse(startWhatsappSession()));
});

router.post("/whatsapp/session/disconnect", async (_req, res) => {
  res.json(
    DisconnectWhatsappSessionResponse.parse(await disconnectWhatsappSession()),
  );
});

router.get("/whatsapp/qr", (_req, res) => {
  const status = getWhatsappStatus();
  res.json(GetWhatsappQrResponse.parse({ status: status.status, qr: status.qr }));
});

router.get("/verifications", (req, res) => {
  const { limit } = ListVerificationsQueryParams.parse(req.query);
  res.json(ListVerificationsResponse.parse(listVerifications(limit)));
});

router.post("/verifications", async (req, res) => {
  const body = CreateVerificationBody.parse(req.body);
  const result = await verifyClaim({
    content: body.content,
    source: body.source,
  });
  res.json(CreateVerificationResponse.parse(result));
});

export default router;