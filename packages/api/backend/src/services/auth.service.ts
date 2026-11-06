import bcrypt from "bcryptjs";
import { prisma } from "../utils/prisma";

import jwt from "jsonwebtoken";
import { seedDefaultUsersNow } from "../utils/seed-default-users";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

export class AuthService {
  private static sanitizeUsername(raw: string) {
    return raw.trim().toLowerCase();
  }

  private static async resolveUsername(
    email: string,
    username?: string
  ): Promise<string> {
    const provided = username ? this.sanitizeUsername(username) : "";
    if (provided) {
      const existing = await prisma.user.findUnique({
        where: { username: provided },
      });
      if (existing) throw new Error("Username already taken");
      return provided;
    }

    const base = this.sanitizeUsername(email.split("@")[0] || "user");
    let candidate = base || "user";
    let suffix = 0;
    while (
      await prisma.user.findUnique({
        where: { username: candidate },
      })
    ) {
      suffix += 1;
      candidate = `${base}${suffix}`;
    }
    return candidate;
  }

  // Hash password
  static async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  // Compare password
  static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // Generate JWT token
  static generateToken(userId: string, agencyId: string): string {
    return jwt.sign({ userId, agencyId }, JWT_SECRET, { expiresIn: "24h" });
  }

  // Generate refresh token (longer expiry)
  static generateRefreshToken(userId: string): string {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
  }

  // Verify token
  static verifyToken(
    token: string
  ): { userId: string; agencyId: string } | null {
    try {
      return jwt.verify(token, JWT_SECRET) as {
        userId: string;
        agencyId: string;
      };
    } catch {
      return null;
    }
  }

  // Sign up
  static async signup(
    email: string,
    password: string,
    agencyName: string,
    username?: string
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) throw new Error("User already exists");

    const resolvedUsername = await this.resolveUsername(normalizedEmail, username);
    const hashedPassword = await this.hashPassword(password);

    // Create agency
    const agency = await prisma.agency.create({
      data: { name: agencyName },
    });

    // Create user
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        username: resolvedUsername,
        password: hashedPassword,
        firstName: "",
        agencyId: agency.id,
        role: "ADMIN",
      },
    });

    const token = this.generateToken(user.id, agency.id);
    const refreshToken = this.generateRefreshToken(user.id);

    return {
      user: { id: user.id, email: user.email, username: user.username },
      token,
      refreshToken,
    };
  }

  // Login
  static async login(identifier: string, password: string) {
    const normalized = identifier.trim();

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: normalized, mode: "insensitive" } },
          { username: { equals: normalized, mode: "insensitive" } },
        ],
      },
    });

    if (!user && process.env.SEED_DEFAULT_USERS === "true") {
      const seeded = await seedDefaultUsersNow();
      if (seeded) {
        user = await prisma.user.findFirst({
          where: {
            OR: [
              { email: { equals: normalized, mode: "insensitive" } },
              { username: { equals: normalized, mode: "insensitive" } },
            ],
          },
        });
      }
    }

    if (!user) throw new Error("Invalid credentials");

    const isValidPassword = await this.comparePassword(password, user.password);
    if (!isValidPassword) throw new Error("Invalid credentials");

    const token = this.generateToken(user.id, user.agencyId);
    const refreshToken = this.generateRefreshToken(user.id);

    return {
      user: { id: user.id, email: user.email, username: user.username },
      token,
      refreshToken,
    };
  }

  // Refresh token
  static async refreshToken(refreshToken: string) {
    const decoded = this.verifyToken(refreshToken);
    if (!decoded) throw new Error("Invalid token");

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) throw new Error("User not found");

    const newToken = this.generateToken(user.id, user.agencyId);
    return { token: newToken };
  }
}
