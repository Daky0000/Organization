import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ message: "Use /api/integrations for OAuth flows." });
});

export default router;
