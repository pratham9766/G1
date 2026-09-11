import "reflect-metadata";
import { auditContext } from "./audit-context";
import "dotenv/config";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ApiController } from "./controller";
import { authenticate } from "./auth";
import { store } from "./store";
import { production } from "./security";
import { startProcessing, stopProcessing } from "./ingestion";
import { WorkflowController } from "./workflow/controller";
import { startWorkflow, stopWorkflow } from "./workflow/service";
@Module({ controllers: [ApiController, WorkflowController] })
class AppModule {}
export async function bootstrap(port = Number(process.env.PORT || 3001)) {
  if (production)
    throw new Error(
      "Production is intentionally gated pending independent vault identities, KMS, isolated parsers, verified integrations and clinical/security validation. See docs/WORK_STATUS.md.",
    );
  await store.init();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn"],
    rawBody: true,
    bodyParser: false,
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(cookieParser());
  app.use(
    express.json({
      limit: "10mb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use("/api", (_req: any, res: any, next: any) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { message: "Too many requests; wait a minute and retry" },
    }),
  );
  app.use(
    "/api/v1/auth/login",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 30,
      message: { message: "Too many sign-in attempts; try again later" },
    }),
  );
  // This development modular monolith serializes state-changing HTTP requests.
  // Production requires transactional compare-and-swap in separately credentialed services.
  let mutations: Promise<void> = Promise.resolve();
  app.use("/api", async (req: any, res: any, next: any) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const previous = mutations;
    let release!: () => void;
    mutations = new Promise<void>((resolve) => (release = resolve));
    await previous;
    res.once("finish", release);
    res.once("close", release);
    next();
  });
  app.use("/api", async (req: any, res: any, next: any) => {
    try {
      const path = req.path;
      const origin = req.headers.origin;
      const permitted = new Set([
        process.env.APP_ORIGIN || "http://localhost:5173",
        "http://127.0.0.1:5173",
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
      ]);
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        origin &&
        !permitted.has(origin)
      )
        return res.status(403).json({ message: "Untrusted request origin" });
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.headers["sec-fetch-site"] === "cross-site"
      )
        return res.status(403).json({ message: "Cross-site request rejected" });
      const publicRoutes = [
        "/v1/health",
        "/v1/auth/login",
        "/v1/auth/register",
        "/v1/auth/refresh",
        "/v1/integrations/hmis/callback",
        "/v1/integrations/abdm/callback",
      ];
      if (!publicRoutes.includes(path))
        Object.assign(req, await authenticate(req));
      auditContext.run(
        {
          actorRole: req.user?.role || "anonymous",
          ip: req.ip || "unavailable",
          sessionId: req.session?.id || "none",
          device: String(req.headers["user-agent"] || "").slice(0, 200),
        },
        () => next(),
      );
    } catch (e: any) {
      res.status(e.getStatus?.() || 500).json({
        message: e.getStatus ? e.message : "Request could not be completed",
      });
    }
  });
  if (existsSync(resolve("dist/index.html"))) {
    app.use(express.static(resolve("dist")));
    app.use((req: any, res: any, next: any) => {
      if (req.method === "GET" && !req.path.startsWith("/api"))
        res.sendFile(resolve("dist/index.html"));
      else next();
    });
  }
  await startProcessing();
  startWorkflow();
  await app.listen(port, process.env.HOST || "127.0.0.1");
  console.log(
    `G1 running at http://localhost:${port} (development; synthetic data only)`,
  );
  return app;
}
if (require.main === module)
  bootstrap()
    .then((app) => {
      for (const signal of ["SIGINT", "SIGTERM"])
        process.on(signal, async () => {
          await stopWorkflow();
          await stopProcessing();
          await app.close();
          await store.close();
          process.exit(0);
        });
    })
    .catch(() => {
      console.error(
        "G1 startup failed. Check configuration and service availability.",
      );
      process.exitCode = 1;
    });
