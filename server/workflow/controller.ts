import {
  Controller,
  Get,
  Post,
  Delete,
  Req,
  Res,
  Body,
  Param,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AuthRequest, authenticate } from "../auth";
import { store } from "../store";
import {
  connectionView,
  connectABHA,
  refreshABHA,
  disconnectABHA,
  resolvePatient,
  requestHealthInformation,
  listRequests,
  visibleRequest,
  publicRequest,
  decideConsent,
  retryRetrieval,
} from "./service";
import { requireDoctorTrust } from "./trust";
import { abdmMode } from "./adapters";
const ctx = (r: AuthRequest) => ({
  ip: r.ip,
  sessionId: r.session.id,
  device: r.headers["user-agent"],
});
const connections = new Map<string, number>();
function body<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException("Invalid request fields");
  return result.data;
}
@Controller("api/v1/workflow")
export class WorkflowController {
  @Get("health") health() {
    return {
      mode: abdmMode(),
      liveConnected: false,
      syntheticOnly: true,
      message:
        abdmMode() === "mock"
          ? "DEMO / SYNTHETIC DATA"
          : "Health information service temporarily unavailable",
    };
  }
  @Get("identity") identity(@Req() r: AuthRequest) {
    return connectionView(r.user);
  }
  @Post("identity/connect") connect(
    @Req() r: AuthRequest,
    @Body() input: unknown,
  ) {
    return connectABHA(
      r.user,
      body(z.object({ identifier: z.string().max(100) }).strict(), input),
      ctx(r),
    );
  }
  @Post("identity/refresh") refresh(@Req() r: AuthRequest) {
    return refreshABHA(r.user, ctx(r));
  }
  @Delete("identity") disconnect(@Req() r: AuthRequest) {
    return disconnectABHA(r.user, ctx(r));
  }
  @Post("resolve") resolve(@Req() r: AuthRequest, @Body() input: unknown) {
    const b = body(
      z.union([
        z.object({ qr: z.string().max(1024) }).strict(),
        z.object({ identifier: z.string().max(100) }).strict(),
      ]),
      input,
    );
    return resolvePatient(r.user, b, ctx(r));
  }
  @Get("trust") async trust(@Req() r: AuthRequest) {
    const { doctor, hospital } = await requireDoctorTrust(r.user);
    return {
      professionalVerified: doctor.verified,
      hospitalVerified: hospital.verified,
      hospitalName: hospital.name,
      mode: abdmMode(),
    };
  }
  @Get("requests") requests(@Req() r: AuthRequest) {
    return listRequests(r.user);
  }
  @Post("requests") request(@Req() r: AuthRequest, @Body() input: unknown) {
    return requestHealthInformation(r.user, input, ctx(r));
  }
  @Get("requests/:id") async requestStatus(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    return publicRequest(await visibleRequest(r.user, id));
  }
  @Post("requests/:id/decision") decision(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return decideConsent(
      r.user,
      id,
      body(
        z.object({ decision: z.enum(["approve", "deny", "revoke"]) }).strict(),
        input,
      ).decision,
      ctx(r),
    );
  }
  @Post("requests/:id/retry") retry(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    return retryRetrieval(r.user, id);
  }
  @Get("events") async events(@Req() r: AuthRequest, @Res() res: Response) {
    if ((connections.get(r.user.id) || 0) >= 4)
      throw new BadRequestException("Too many live connections");
    connections.set(r.user.id, (connections.get(r.user.id) || 0) + 1);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    let last = "",
      running = false,
      closed = false;
    const send = async () => {
      if (running || closed) return;
      running = true;
      try {
        const { user } = await authenticate(r);
        if (user.role === "doctor") await requireDoctorTrust(user);
        const requests = await listRequests(user);
        const value = JSON.stringify({ requests });
        if (last !== value) {
          last = value;
          res.write(`event: workflow\ndata: ${value}\n\n`);
        } else res.write(": heartbeat\n\n");
      } catch {
        res.write("event: access-ended\ndata: {}\n\n");
        res.end();
      } finally {
        running = false;
      }
    };
    const timer = setInterval(send, 1000);
    res.on("close", () => {
      closed = true;
      clearInterval(timer);
      connections.set(
        r.user.id,
        Math.max(0, (connections.get(r.user.id) || 1) - 1),
      );
    });
    await send();
  }
  @Get("recent-access") async recent(@Req() r: AuthRequest) {
    if (r.user.role !== "patient") throw new ForbiddenException();
    return (await listRequests(r.user)).slice(-10).reverse();
  }
}
