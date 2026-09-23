let prisma;
try {
  const { PrismaClient } = require("@prisma/client");
  const globalForPrisma = globalThis;
  prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
  }
} catch (e) {
  if (process.env.NODE_ENV !== "test") {
    console.warn("[prisma] Failed to initialize PrismaClient, using mock:", e.message);
  }
  prisma = {
    hospital: { findUnique: async () => null, findMany: async () => [], count: async () => 0 },
    user: { findUnique: async () => null, findMany: async () => [], create: async () => ({}), update: async () => ({}) },
    medicine: {
      findFirst: async () => null,
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      groupBy: async () => [],
      count: async () => 0,
    },
    exchangeRequest: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => ({}),
      update: async () => ({}),
      count: async () => 0,
      deleteMany: async () => {},
    },
    notification: {
      findMany: async () => [],
      create: async () => ({}),
      createMany: async () => {},
      updateMany: async () => {},
      deleteMany: async () => {},
    },
    inventoryMovement: {
      findMany: async () => [],
      create: async () => ({}),
      createMany: async () => {},
      deleteMany: async () => {},
    },
    report: { findMany: async () => [], createMany: async () => {}, deleteMany: async () => {} },
    conversation: {
      findUnique: async () => { throw new Error("DB unavailable - conversation"); },
      findFirst: async () => { throw new Error("DB unavailable - conversation"); },
      findMany: async () => { throw new Error("DB unavailable - conversation"); },
      create: async () => { throw new Error("DB unavailable - conversation"); },
      update: async () => { throw new Error("DB unavailable - conversation"); },
      delete: async () => { throw new Error("DB unavailable - conversation"); },
    },
    aIMessage: {
      findMany: async () => { throw new Error("DB unavailable - aiMessage"); },
      create: async () => { throw new Error("DB unavailable - aiMessage"); },
      deleteMany: async () => { throw new Error("DB unavailable - aiMessage"); },
    },
    aiMessage: {
      findMany: async () => { throw new Error("DB unavailable - aiMessage"); },
      create: async () => { throw new Error("DB unavailable - aiMessage"); },
      deleteMany: async () => { throw new Error("DB unavailable - aiMessage"); },
    },
    $transaction: async (fn) => {
      const tx = prisma;
      if (typeof fn === "function") return fn(tx);
      return fn;
    },
  };
}

module.exports = prisma;
