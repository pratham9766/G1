import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Req,
  Res,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { store } from "./store";
import {
  AuthRequest,
  createUser,
  issueSession,
  login,
  newMfaSecret,
  revokeFamily,
  safeUser,
  verifyTotp,
} from "./auth";
import { active, authorizedFacts, authorize, requireDocument } from "./policy";
import { buildBrief, deduplicate } from "./clinical";
import { ingest, readObject, deleteObject, enqueue } from "./ingestion";
import { hash, production } from "./security";
import {
  Consent,
  Fact,
  MedicalDocument,
  User,
  RECORD_TYPES,
  PURPOSES,
} from "./types";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Enter a valid date",
  );
const credentials = z
  .object({
    email: z.email().max(254),
    password: z.string().min(12).max(128),
    code: z.string().optional(),
  })
  .strict();
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success)
    throw new BadRequestException(
      r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  return r.data;
};
const clinicalContext = (r: AuthRequest) =>
  [
    String(r.headers["x-consent-id"] || ""),
    String(r.headers["x-purpose"] || ""),
  ] as const;
function role(r: AuthRequest, allowed: string) {
  if (r.user.role !== allowed)
    throw new ForbiddenException(
      "This action is not available for your account",
    );
}
function consentView(c: Consent) {
  return {
    ...c,
    status: c.status === "granted" && !active(c) ? "expired" : c.status,
  };
}
@Controller("api/v1")
export class ApiController {
  @Get("health") health() {
    return {
      status: "ok",
      environment: production ? "production" : "development",
      clinicalValidation: "not-validated",
      abdm: "not-configured",
    };
  }
  @Post("auth/register") async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const b = parse(
      credentials.extend({ name: z.string().trim().min(2).max(100) }),
      body,
    );
    const u = await createUser(b.email, b.password, b.name);
    await store.audit(u.id, u.patientId!, "account.created", "");
    return issueSession(u, res);
  }
  @Post("auth/login") async signIn(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const b = parse(credentials, body);
    return login(b.email, b.password, b.code, res);
  }
  @Post("auth/refresh") async refresh(
    @Req() r: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = r.cookies?.g1_refresh
      ? await store.get("identity", hash(r.cookies.g1_refresh))
      : undefined;
    if (!s || s.kind !== "refresh" || s.revoked || s.expires < Date.now())
      throw new UnauthorizedException("Session expired");
    if (s.used) {
      await revokeFamily(s.family, s.userId);
      throw new UnauthorizedException(
        "Refresh token reuse detected; sign in again",
      );
    }
    s.used = true;
    await store.put("identity", s);
    const u = await store.get<User>("identity", s.userId);
    if (!u || u.disabled) throw new UnauthorizedException();
    for (const old of await store.list("identity", "session", { owner: u.id }))
      if (old.family === s.family) {
        old.revoked = true;
        await store.put("identity", old);
      }
    return issueSession(u, res, s.family);
  }
  @Get("auth/me") me(@Req() r: AuthRequest) {
    return { user: safeUser(r.user), csrf: r.session.csrf };
  }
  @Post("auth/logout") async logout(
    @Req() r: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await revokeFamily(r.session.family, r.user.id);
    res.clearCookie("g1_access", { path: "/api" });
    res.clearCookie("g1_refresh", { path: "/api" });
    return { ok: true };
  }
  @Get("auth/sessions") async sessions(@Req() r: AuthRequest) {
    return (await store.list("identity", "session", { owner: r.user.id }))
      .filter((s) => !s.revoked && s.expires > Date.now())
      .map((s) => ({
        id: s.id,
        expires: s.expires,
        current: s.id === r.session.id,
      }));
  }
  @Delete("auth/sessions/:id") async revokeSession(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    const s = await store.get("identity", id);
    if (!s || s.owner !== r.user.id || s.kind !== "session")
      throw new NotFoundException();
    await revokeFamily(s.family, r.user.id);
    return { ok: true };
  }
  @Post("auth/mfa/setup") async mfaSetup(@Req() r: AuthRequest) {
    if (r.user.mfaSecret)
      throw new BadRequestException("MFA is already enabled");
    const secret = newMfaSecret();
    r.user.pendingMfa = secret.hex;
    await store.put("identity", r.user);
    return {
      secret: secret.base32,
      uri: `otpauth://totp/G1:${encodeURIComponent(r.user.email)}?secret=${secret.base32}&issuer=G1`,
    };
  }
  @Post("auth/mfa/confirm") async mfaConfirm(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    const b = parse(z.object({ code: z.string() }), body);
    const step = r.user.pendingMfa
      ? verifyTotp(r.user.pendingMfa, b.code)
      : undefined;
    if (step === undefined)
      throw new BadRequestException("Authenticator code is invalid");
    r.user.mfaSecret = r.user.pendingMfa;
    delete r.user.pendingMfa;
    r.user.mfaLastStep = step;
    await store.put("identity", r.user);
    await store.audit(
      r.user.id,
      r.user.patientId || "",
      "mfa.enabled",
      r.user.tenant,
    );
    return { ok: true };
  }
  @Get("patients") async patients(@Req() r: AuthRequest) {
    if (r.user.role === "patient") return [safeUser(r.user)];
    role(r, "doctor");
    if (!r.user.verified)
      throw new ForbiddenException("Hospital verification is required");
    const consents = (
      await store.list<Consent>("consent", "consent", { tenant: r.user.tenant })
    ).filter((c) => c.doctorId === r.user.id && active(c));
    const users = await store.list<User>("identity", "user");
    return users
      .filter(
        (u) =>
          u.role === "patient" &&
          consents.some((c) => c.patientId === u.patientId),
      )
      .map((u) => ({
        patientId: u.patientId,
        name: u.name,
        consents: consents
          .filter((c) => c.patientId === u.patientId)
          .map(consentView),
      }));
  }
  @Get("patients/:id/brief") async brief(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    const data = await authorizedFacts(r.user, id, ...clinicalContext(r));
    const patient = (
      await store.list<User>("identity", "user", { owner: id })
    ).find((u) => u.role === "patient");
    const age = patient?.dob
      ? Math.floor((Date.now() - Date.parse(patient.dob)) / 31557600000)
      : null;
    return {
      ...buildBrief(data.facts, data.docs),
      patient: {
        name: patient?.name || "Patient",
        age,
        sex: patient?.sex || "not provided",
      },
      consent: data.c ? consentView(data.c) : null,
    };
  }
  @Get("patients/:id/timeline") async timeline(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    return (await this.brief(r, id)).timeline;
  }
  @Get("patients/:id/conflicts") async conflicts(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    return (await this.brief(r, id)).conflicts;
  }
  @Get("facts/:id/evidence") async evidence(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    const fact = await store.get<Fact>("clinical", id);
    if (!fact || fact.kind !== "fact")
      throw new NotFoundException("Fact not found");
    const data = await authorizedFacts(
      r.user,
      fact.patientId,
      ...clinicalContext(r),
    );
    const allowed = deduplicate(data.facts).find((f) => f.id === id);
    if (!allowed)
      throw new ForbiddenException("Evidence is outside consent scope");
    await store.audit(
      r.user.id,
      fact.patientId,
      "evidence.read",
      r.user.tenant,
      clinicalContext(r)[1],
      data.c?.id || "",
      { factId: id },
    );
    return { factId: id, evidence: allowed.evidence };
  }
  @Get("records") async records(@Req() r: AuthRequest) {
    role(r, "patient");
    return store.list<MedicalDocument>("clinical", "document", {
      owner: r.user.patientId!,
    });
  }
  @Post("documents")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 },
    }),
  )
  async upload(
    @Req() r: AuthRequest,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File,
  ) {
    role(r, "patient");
    const b = parse(
      z.object({ recordType: z.enum(RECORD_TYPES), recordDate: date }).strict(),
      body,
    );
    if (!file) throw new BadRequestException("Choose a record to upload");
    const d = await ingest(
      r.user.patientId!,
      file.originalname,
      file.mimetype,
      file.buffer,
      b.recordType,
      b.recordDate,
    );
    await store.audit(
      r.user.id,
      r.user.patientId!,
      "document.uploaded",
      "",
      "self",
      "",
      { documentId: d.id },
    );
    return d;
  }
  @Get("documents/:id/status") async documentStatus(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    const d = await requireDocument(r.user, id, ...clinicalContext(r));
    return { id: d.id, status: d.status, error: d.error, attempts: d.attempts };
  }
  @Get("documents/:id/source") async source(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const d = await requireDocument(r.user, id, ...clinicalContext(r));
    if (d.status !== "completed")
      throw new BadRequestException(
        "Source is not available until processing completes",
      );
    const bytes = await readObject(d.storageKey);
    if (hash(bytes) !== d.hash)
      throw new ServiceUnavailableException(
        "Source integrity verification failed",
      );
    await store.audit(
      r.user.id,
      d.patientId,
      "source.read",
      r.user.tenant,
      clinicalContext(r)[1],
      clinicalContext(r)[0],
      { documentId: id },
    );
    res.setHeader("Content-Type", d.mime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="record-${d.id}.${d.mime === "application/pdf" ? "pdf" : d.mime.includes("json") ? "json" : d.mime === "image/png" ? "png" : d.mime === "image/jpeg" ? "jpg" : "txt"}"`,
    );
    res.send(bytes);
  }
  @Post("documents/:id/retry") async retry(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    role(r, "patient");
    const d = await requireDocument(r.user, id);
    if (d.status !== "failed")
      throw new BadRequestException("Only failed records can be retried");
    d.status = "queued";
    d.error = undefined;
    await store.put("clinical", d);
    await enqueue(d);
    return d;
  }
  @Delete("documents/:id") async deleteDocument(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    role(r, "patient");
    const d = await requireDocument(r.user, id);
    if (d.status === "processing")
      throw new BadRequestException(
        "Wait for processing to finish before deletion",
      );
    d.status = "deleting";
    await store.put("clinical", d);
    await deleteObject(d.storageKey);
    for (const f of await store.list<Fact>("clinical", "fact", {
      owner: d.patientId,
    }))
      if (f.evidence.some((e) => e.documentId === id))
        await store.remove("clinical", f.id);
    await store.remove("clinical", id);
    await store.audit(
      r.user.id,
      d.patientId,
      "document.deleted",
      "",
      "self",
      "",
      { documentId: id },
    );
    return { ok: true };
  }
  @Get("consents") async consents(@Req() r: AuthRequest) {
    const u = r.user;
    const all = await store.list<Consent>(
      "consent",
      "consent",
      u.role === "patient" ? { owner: u.patientId! } : { tenant: u.tenant },
    );
    return all
      .filter((c) => u.role !== "doctor" || c.doctorId === u.id)
      .map(consentView);
  }
  @Post("consents/requests") async requestConsent(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    role(r, "doctor");
    if (!r.user.verified)
      throw new ForbiddenException("Clinician verification is required");
    const b = parse(
      z
        .object({
          patientId: z.uuid(),
          purpose: z.enum(PURPOSES as [string, ...string[]]),
          scope: z.array(z.enum(RECORD_TYPES)).min(1).max(5),
          fromDate: date,
          toDate: date,
          validUntil: z.iso.datetime(),
        })
        .strict(),
      body,
    );
    const validity = Date.parse(b.validUntil);
    if (
      b.fromDate > b.toDate ||
      validity <= Date.now() ||
      validity > Date.now() + 30 * 86400000
    )
      throw new BadRequestException(
        "Use an ordered date range and expiry within 30 days",
      );
    if (
      !(
        await store.list<User>("identity", "user", { owner: b.patientId })
      ).some((u) => u.role === "patient")
    )
      throw new BadRequestException("Patient reference is unavailable");
    const c: Consent = {
      id: randomUUID(),
      kind: "consent",
      owner: b.patientId,
      tenant: r.user.tenant,
      ...b,
      doctorId: r.user.id,
      doctorName: r.user.name,
      scope: [...new Set(b.scope)],
      status: "requested",
      createdAt: new Date().toISOString(),
    };
    await store.put("consent", c);
    await store.audit(
      r.user.id,
      b.patientId,
      "consent.requested",
      r.user.tenant,
      b.purpose,
      c.id,
    );
    return c;
  }
  @Post("consents/:id/:action") async changeConsent(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Param("action") action: string,
  ) {
    role(r, "patient");
    const c = await store.get<Consent>("consent", id);
    if (!c || c.kind !== "consent" || c.owner !== r.user.patientId)
      throw new NotFoundException("Consent not found");
    const next = (
      { grant: "granted", deny: "denied", revoke: "revoked" } as const
    )[action as "grant" | "deny" | "revoke"];
    if (
      !next ||
      (["grant", "deny"].includes(action) && c.status !== "requested") ||
      (action === "revoke" && c.status !== "granted") ||
      (action === "grant" && Date.parse(c.validUntil) <= Date.now())
    )
      throw new BadRequestException("This consent transition is not allowed");
    c.status = next;
    await store.put("consent", c);
    await store.audit(
      r.user.id,
      c.patientId,
      `consent.${next}`,
      c.tenant,
      c.purpose,
      c.id,
    );
    return consentView(c);
  }
  @Get("profile") profile(@Req() r: AuthRequest) {
    role(r, "patient");
    return {
      patientId: r.user.patientId,
      name: r.user.name,
      dob: r.user.dob || "",
      sex: r.user.sex || "",
      emergencyProfile: r.user.emergencyProfile || "",
      abhaStatus: "not-linked",
    };
  }
  @Patch("profile") async editProfile(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    role(r, "patient");
    const b = parse(
      z
        .object({
          name: z.string().min(2).max(100),
          dob: date.or(z.literal("")),
          sex: z.enum(["female", "male", "other", "prefer-not-to-say", ""]),
          emergencyProfile: z.string().max(3000),
        })
        .strict(),
      body,
    );
    Object.assign(r.user, b);
    await store.put("identity", r.user);
    await store.audit(r.user.id, r.user.patientId!, "profile.updated", "");
    return this.profile(r);
  }
  @Get("audit/me") async audit(@Req() r: AuthRequest) {
    const u = r.user;
    const events = await store.list(
      "audit",
      "audit",
      u.role === "patient" ? { owner: u.patientId! } : { tenant: u.tenant },
    );
    return events
      .filter((e) => u.role !== "doctor" || e.actor === u.id)
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, 200);
  }
  @Get("notifications") notifications(@Req() r: AuthRequest) {
    return store.list("clinical", "notification", {
      owner: r.user.patientId || r.user.id,
    });
  }
  @Post("doctors/:id/annotations") async annotate(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    role(r, "doctor");
    if (id !== r.user.id) throw new ForbiddenException();
    const policy = await store.get("consent", `policy:${r.user.tenant}`);
    if (policy?.annotationsEnabled === false)
      throw new ForbiddenException(
        "Clinical annotations are disabled by hospital policy",
      );
    const b = parse(
      z
        .object({
          patientId: z.uuid(),
          factId: z.string().min(1),
          note: z.string().trim().min(3).max(2000),
          type: z.enum(["annotation", "flag"]),
        })
        .strict(),
      body,
    );
    const data = await authorizedFacts(
      r.user,
      b.patientId,
      ...clinicalContext(r),
    );
    if (!data.facts.some((f) => f.id === b.factId))
      throw new ForbiddenException("Fact is outside consent");
    const a = {
      id: randomUUID(),
      kind: "annotation",
      owner: b.patientId,
      tenant: r.user.tenant,
      doctorId: id,
      ...b,
      createdAt: new Date().toISOString(),
    };
    await store.put("clinical", a);
    await store.audit(
      id,
      b.patientId,
      `fact.${b.type}`,
      r.user.tenant,
      clinicalContext(r)[1],
      data.c?.id || "",
      { factId: b.factId },
    );
    return a;
  }
  @Get("patients/:id/annotations") async annotations(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    const data = await authorizedFacts(r.user, id, ...clinicalContext(r));
    return (await store.list("clinical", "annotation", { owner: id })).filter(
      (a) =>
        (r.user.role === "patient" || a.tenant === r.user.tenant) &&
        data.facts.some((f) => f.id === a.factId),
    );
  }
  @Get("hospital") async hospital(@Req() r: AuthRequest) {
    role(r, "hospital");
    const users = await store.list<User>("identity", "user", {
      tenant: r.user.tenant,
    });
    const org = await store.get("identity", r.user.tenant);
    return {
      organization: org,
      doctors: users
        .filter((u) => u.role === "doctor")
        .map((u) => ({
          ...safeUser(u),
          disabled: !!u.disabled,
          professionalRef: u.professionalRef,
        })),
      departments: await store.list("identity", "department", {
        tenant: r.user.tenant,
      }),
      policy: await store.get("consent", `policy:${r.user.tenant}`),
      auditIntegrity: await store.verifyAudit(),
    };
  }
  @Post("hospital/doctors") async addDoctor(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    role(r, "hospital");
    const b = parse(
      credentials.extend({
        name: z.string().min(2).max(100),
        department: z.string().max(80),
        professionalRef: z.string().min(3).max(100),
      }),
      body,
    );
    const u = await createUser(
      b.email,
      b.password,
      b.name,
      "doctor",
      r.user.tenant,
      {
        department: b.department,
        professionalRef: b.professionalRef,
        verified: false,
      },
    );
    await store.audit(r.user.id, "", "doctor.created", r.user.tenant);
    return safeUser(u);
  }
  @Patch("hospital/doctors/:id") async editDoctor(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    role(r, "hospital");
    const b = parse(
      z.object({ verified: z.boolean(), disabled: z.boolean() }).strict(),
      body,
    );
    const u = await store.get<User>("identity", id);
    if (!u || u.role !== "doctor" || u.tenant !== r.user.tenant)
      throw new NotFoundException();
    Object.assign(u, b);
    await store.put("identity", u);
    if (b.disabled || !b.verified)
      for (const s of await store.list("identity", "session", { owner: id }))
        await revokeFamily(s.family, id);
    await store.audit(r.user.id, "", "doctor.updated", r.user.tenant, "", "", {
      doctorId: id,
      ...b,
    });
    return safeUser(u);
  }
  @Post("hospital/departments") async department(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    role(r, "hospital");
    const b = parse(
      z.object({ name: z.string().trim().min(2).max(80) }).strict(),
      body,
    );
    return store.put("identity", {
      id: randomUUID(),
      kind: "department",
      owner: r.user.tenant,
      tenant: r.user.tenant,
      name: b.name,
    });
  }
  @Patch("hospital/policy") async policy(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    role(r, "hospital");
    const b = parse(
      z
        .object({
          retentionDays: z.number().int().min(1).max(3650),
          incidentContact: z.email(),
          annotationsEnabled: z.boolean(),
        })
        .strict(),
      body,
    );
    const p = await store.put("consent", {
      id: `policy:${r.user.tenant}`,
      kind: "policy",
      owner: r.user.tenant,
      tenant: r.user.tenant,
      ...b,
    });
    await store.audit(r.user.id, "", "policy.updated", r.user.tenant);
    return p;
  }
  @Get("integrations/abdm/health") abdm(@Req() r: AuthRequest) {
    return {
      status: "not-configured",
      lastSuccessfulSync: null,
      message:
        "ABDM sandbox onboarding and a validated current M3 adapter are required. No live exchange is enabled.",
      documentation: "https://sandbox.abdm.gov.in/sandbox/v3/documentation",
      hmis: process.env.HMIS_WEBHOOK_SECRET ? "configured" : "not-configured",
    };
  }
  @Post("integrations/abdm/callback") abdmCallback() {
    throw new ServiceUnavailableException(
      "ABDM protocol adapter is not configured; callbacks are not accepted",
    );
  }
  @Post("integrations/hmis/callback") async hmis(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    const secret = process.env.HMIS_WEBHOOK_SECRET;
    if (!secret)
      throw new ServiceUnavailableException("HMIS connector is not configured");
    const stamp = String(r.headers["x-timestamp"] || "");
    const requestId = String(r.headers["x-request-id"] || "");
    const signature = String(r.headers["x-signature"] || "");
    if (
      !/^\d{13}$/.test(stamp) ||
      Math.abs(Date.now() - Number(stamp)) > 300000 ||
      !z.uuid().safeParse(requestId).success ||
      !r.rawBody ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      throw new UnauthorizedException("Invalid callback");
    const expected = createHmac("sha256", secret)
      .update(`${stamp}.${requestId}.`)
      .update(r.rawBody)
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      throw new UnauthorizedException("Invalid callback signature");
    if (await store.get("consent", `callback:${requestId}`))
      throw new BadRequestException("Callback replay rejected");
    const b = parse(
      z
        .object({
          consentId: z.uuid(),
          recordDate: date,
          recordType: z.enum(RECORD_TYPES),
          bundle: z.record(z.string(), z.unknown()),
        })
        .strict(),
      body,
    );
    const c = await store.get<Consent>("consent", b.consentId);
    if (
      !c ||
      !active(c) ||
      !c.scope.includes(b.recordType) ||
      b.recordDate < c.fromDate ||
      b.recordDate > c.toDate
    )
      throw new ForbiddenException("Callback is outside consent");
    await store.put("consent", {
      id: `callback:${requestId}`,
      kind: "callback",
      owner: c.patientId,
      tenant: c.tenant,
      receivedAt: new Date().toISOString(),
    });
    const d = await ingest(
      c.patientId,
      "HMIS FHIR Bundle",
      "application/fhir+json",
      Buffer.from(JSON.stringify(b.bundle)),
      b.recordType,
      b.recordDate,
    );
    await store.audit(
      "hmis",
      c.patientId,
      "integration.ingested",
      c.tenant,
      c.purpose,
      c.id,
      { requestId, documentId: d.id },
    );
    return { accepted: true, documentId: d.id };
  }
}
