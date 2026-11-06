import bcrypt from "bcryptjs";
import { prisma } from "./prisma";



const DEFAULT_AGENCY = "Default Agency";
const MAX_RETRIES = Number(process.env.SEED_DEFAULT_USERS_RETRIES || "5");
const RETRY_DELAY_MS = Number(process.env.SEED_DEFAULT_USERS_DELAY_MS || "5000");

const ensureAgency = async () => {
  let agency = await prisma.agency.findFirst({ where: { name: DEFAULT_AGENCY } });
  if (!agency) {
    agency = await prisma.agency.create({ data: { name: DEFAULT_AGENCY } });
  }
  return agency;
};

const isUsernameAvailable = async (username: string, email?: string) => {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) return true;
  return email ? existing.email === email : false;
};

const upsertUser = async ({
  email,
  username,
  password,
  role,
  agencyId,
}: {
  email: string;
  username: string;
  password: string;
  role: "ADMIN" | "MANAGER" | "VIEWER";
  agencyId: string;
}) => {
  const hashed = await bcrypt.hash(password, 10);
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUsername = username.trim().toLowerCase();
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  const usernameToUse = (await isUsernameAvailable(
    normalizedUsername,
    normalizedEmail
  ))
    ? normalizedUsername
    : undefined;

  if (existing) {
    return prisma.user.update({
      where: { email: normalizedEmail },
      data: {
        password: hashed,
        role,
        agencyId,
        ...(usernameToUse ? { username: usernameToUse } : {}),
      },
    });
  }

  return prisma.user.create({
    data: {
      email: normalizedEmail,
      username: usernameToUse,
      password: hashed,
      firstName: "",
      lastName: "",
      role,
      agencyId,
    },
  });
};

const seedDefaultUsersOnce = async () => {
  const agency = await ensureAgency();

  await upsertUser({
    email: "admin@example.com",
    username: "admin",
    password: "admin",
    role: "ADMIN",
    agencyId: agency.id,
  });

  await upsertUser({
    email: "user@example.com",
    username: "user",
    password: "user",
    role: "MANAGER",
    agencyId: agency.id,
  });
};

export const seedDefaultUsersNow = async () => {
  if (process.env.SEED_DEFAULT_USERS !== "true") return false;

  const userCount = await prisma.user.count();
  if (userCount > 0) return false;

  await seedDefaultUsersOnce();
  return true;
};

export const seedDefaultUsers = async (attempt = 1): Promise<void> => {
  if (process.env.SEED_DEFAULT_USERS !== "true") return;

  try {
    await seedDefaultUsersNow();
    console.log("Default users ensured.");
  } catch (error) {
    console.error(`Default user seeding failed (attempt ${attempt}).`, error);

    if (attempt < MAX_RETRIES) {
      setTimeout(() => {
        void seedDefaultUsers(attempt + 1);
      }, RETRY_DELAY_MS);
    }
  }
};
