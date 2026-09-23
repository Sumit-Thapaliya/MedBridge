// apps/backend/src/admin.mjs
//
// AdminJS v7 is ESM-only, while the rest of this backend is CommonJS.
// Keeping this one file as .mjs lets Node treat it as ESM without
// converting the whole project — src/index.js loads it via dynamic
// import().

import AdminJS from "adminjs";
import AdminJSExpress from "@adminjs/express";
import { Database, Resource, getModelByName } from "@adminjs/prisma";
import * as PrismaModule from "@prisma/client";
import prisma from "./config/db.js";

AdminJS.registerAdapter({ Database, Resource });

function resource(modelName, options = {}) {
  return {
    resource: {
      model: getModelByName(modelName, PrismaModule),
      client: prisma,
      clientModule: PrismaModule,
    },
    options,
  };
}

export async function buildAdminRouter() {
  const admin = new AdminJS({
    rootPath: "/admin",
    branding: {
      companyName: "MedBridge Admin",
      softwareBrothers: false,
    },
    resources: [
      resource("Hospital"),
      resource("User", {
        properties: {
          passwordHash: { isVisible: false },
        },
      }),
      resource("Medicine"),
      resource("InventoryMovement"),
      resource("ExchangeRequest"),
      resource("Notification"),
      resource("Report"),
    ],
  });

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;

  if (!adminEmail || !adminPassword || !sessionSecret) {
    throw new Error(
      "Missing ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_SESSION_SECRET in .env"
    );
  }

  const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate: async (email, password) => {
        if (email === adminEmail && password === adminPassword) {
          return { email };
        }
        return null;
      },
      cookieName: "adminjs",
      cookiePassword: sessionSecret,
    },
    null,
    {
      secret: sessionSecret,
      resave: false,
      saveUninitialized: true,
    }
  );

  return { adminRouter, rootPath: admin.options.rootPath };
}