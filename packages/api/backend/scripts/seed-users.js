const path = require("path");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const prisma = new PrismaClient();

async function ensureAgency() {
  let agency = await prisma.agency.findFirst({ where: { name: "Default Agency" } });
  if (!agency) {
    agency = await prisma.agency.create({ data: { name: "Default Agency" } });
  }
  return agency;
}

async function upsertUser({ email, username, password, role, agencyId }) {
  const hashed = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return prisma.user.update({
      where: { email },
      data: { password: hashed, role, agencyId, username },
    });
  }
  return prisma.user.create({
    data: {
      email,
      username,
      password: hashed,
      firstName: "",
      lastName: "",
      role,
      agencyId,
    },
  });
}

async function main() {
  const agency = await ensureAgency();

  const admin = await upsertUser({
    email: "admin@example.com",
    username: "admin",
    password: "admin",
    role: "ADMIN",
    agencyId: agency.id,
  });

  const user = await upsertUser({
    email: "user@example.com",
    username: "user",
    password: "user",
    role: "MANAGER",
    agencyId: agency.id,
  });

  console.log("Seeded users:");
  console.log({
    admin: { email: admin.email, username: admin.username },
    user: { email: user.email, username: user.username },
    agency: agency.name,
  });
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
