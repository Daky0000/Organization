import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { IntegrationService } from "../services/integration.service";

const router = Router();

// GET /api/my-integrations
router.get(
  "/",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const integrations = await IntegrationService.getUserIntegrations(
        req.userId!
      );
      res.json(integrations);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

export default router;
