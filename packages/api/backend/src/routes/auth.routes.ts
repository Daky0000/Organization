import { Router, Request, Response } from "express";
import { AuthService } from "../services/auth.service";

const router = Router();

// Sign up
router.post("/signup", async (req: Request, res: Response) => {
  try {
    const { email, password, agencyName, username } = req.body;

    if (!email || !password || !agencyName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await AuthService.signup(
      email,
      password,
      agencyName,
      username
    );
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { identifier, email, password } = req.body;
    const loginId = identifier || email;

    if (!loginId || !password) {
      return res
        .status(400)
        .json({ error: "Missing email/username or password" });
    }

    const result = await AuthService.login(loginId, password);
    res.json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

// Refresh token
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "No refresh token" });
    }

    const result = await AuthService.refreshToken(refreshToken);
    res.json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

export default router;
