import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { store } from "../store";
import { hash } from "../security";
import type { User, Entity, Consent, MedicalDocument, Fact } from "../types";
import { adapter, abdmMode, transferSchema } from "./adapters";
import {
  requestSchema,
  eventSchema,
  WorkflowRequest,
  WorkflowEvent,
} from "./models";
import {
  validateIdentityQR,
  createIdentityQR,
  validateABHA,
  maskABHA,
} from "./qr";
import { requireDoctorTrust } from "./trust";
import { recordTypesFor, INFORMATION_SCOPES } from "./scopes";
import { ingest, processDocument } from "../ingestion";
import { authorizedFacts, authorize, inScope } from "../policy";
import { aiProvider } from "./ai";
import { buildBrief } from "../clinical";
export type AuditContext = { ip?: string; sessionId?: string; device?: string };
let serialQueue: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const result = serialQueue.then(fn);
  serialQueue = result.catch(() => {});
  return result;
}
const now = () => new Date().toISOString();
function entity(
  kind: string,
  owner: string,
  tenant = "",
  extra: Record<string, any> = {},
): Entity {
  return { id: randomUUID(), kind, owner, tenant, createdAt: now(), ...extra };
}
export async function auditWorkflow(
  user: User,
  patientId: string,
  action: string,
  resource: string,
  purpose = "",
  consentId = "",
  ctx: AuditContext = {},
) {
  await store.audit(
    user.id,
    patientId,
    action,
    user.tenant,
    purpose,
    consentId,
    {
      actorRole: user.role,
      resource,
      ip: ctx.ip || "unavailable",
      sessionId: ctx.sessionId || "system",
      device: ctx.device?.slice(0, 200) || "unavailable",
    },
  );
}
export function publicRequest(c: WorkflowRequest) {
  const expired =
    Date.parse(c.validUntil) <= Date.now() &&
    !["DENIED", "REVOKED", "FAILED"].includes(c.workflowStatus);
  return {
    id: c.id,
    patientId: c.patientId,
    doctorId: c.doctorId,
    hospitalId: c.tenant,
    doctorName: c.doctorName,
    hospitalName: c.hospitalName,
    purpose: c.purpose,
    requestedScopes: c.requestedScopes,
    dateFrom: c.fromDate,
    dateTo: c.toDate,
    createdAt: c.createdAt,
    expiresAt: c.validUntil,
    status: expired ? "EXPIRED" : c.workflowStatus,
    transferStatus: expired ? "EXPIRED" : c.transferStatus,
    mode: c.adapterMode,
    lastSuccessfulSync: c.lastSuccessfulSync || null,
    error: c.error || null,
    accessSessionId: c.accessSessionId,
  };
}
export async function ownConnection(user: User) {
  if (user.role !== "patient") throw new ForbiddenException();
  return (
    await store.list("identity", "abhaConnection", { owner: user.patientId! })
  ).find((c) => c.status === "connected");
}
export async function connectionView(user: User) {
  const c = await ownConnection(user);
  return c
    ? {
        id: c.id,
        status: c.status,
        name: c.name,
        maskedABHA: maskABHA(c.number),
        address: c.address,
        verificationStatus:
          Date.now() - Date.parse(c.lastVerifiedAt) <= 86400000
            ? c.verificationStatus
            : "UNVERIFIED",
        verified:
          c.verificationStatus === "VERIFIED" &&
          Date.now() - Date.parse(c.lastVerifiedAt) <= 86400000,
        mode: c.mode,
        connectedAt: c.connectedAt,
        lastVerifiedAt: c.lastVerifiedAt,
        qr: createIdentityQR(c.id),
        qrExpiresAt: new Date(Date.now() + 600000).toISOString(),
      }
    : { status: "disconnected", mode: abdmMode(), name: user.name };
}
export async function connectABHA(
  user: User,
  body: any,
  ctx: AuditContext = {},
) {
  return serial(async () => {
    if (user.role !== "patient") throw new ForbiddenException();
    const identifier = validateABHA(String(body?.identifier || ""));
    const identity = await adapter().verifyABHA(identifier, user); // No user-controlled verified flag.
    const existing = await ownConnection(user);
    if (existing && existing.number !== identity.number)
      throw new BadRequestException(
        "Disconnect the existing identity before replacing it",
      );
    const duplicate = (await store.list("identity", "abhaConnection")).find(
      (c) =>
        c.status === "connected" &&
        c.owner !== user.patientId &&
        (c.number === identity.number || c.address === identity.address),
    );
    if (duplicate)
      throw new BadRequestException("Identity cannot be connected");
    const c =
      existing ||
      entity("abhaConnection", user.patientId!, "", { parentId: user.id });
    Object.assign(c, {
      ...identity,
      mode: abdmMode(),
      synthetic: user.synthetic === true,
      status: "connected",
      connectedAt: existing?.connectedAt || now(),
      lastVerifiedAt: now(),
    });
    await store.put("identity", c);
    await auditWorkflow(
      user,
      user.patientId!,
      "abha.connected",
      c.id,
      "identity-link",
      "",
      ctx,
    );
    return connectionView(user);
  });
}
export async function refreshABHA(user: User, ctx: AuditContext = {}) {
  const c = await ownConnection(user);
  if (!c) throw new BadRequestException("Connect a health identity first");
  return connectABHA(user, { identifier: c.address }, ctx);
}
export async function disconnectABHA(user: User, ctx: AuditContext = {}) {
  return serial(async () => {
    const c = await ownConnection(user);
    if (!c) throw new NotFoundException("Connection not found");
    c.status = "disconnected";
    c.disconnectedAt = now();
    await store.put("identity", c);
    for (const request of await store.list<WorkflowRequest>(
      "consent",
      "consent",
      { owner: user.patientId! },
    ))
      if (
        request.workflow &&
        request.connectionId === c.id &&
        !["DENIED", "REVOKED", "EXPIRED"].includes(request.workflowStatus)
      ) {
        request.status = "revoked";
        request.workflowStatus = "REVOKED";
        request.updatedAt = now();
        await store.put("consent", request);
        await auditWorkflow(
          user,
          request.patientId,
          "consent.revoked",
          request.id,
          request.purpose,
          request.id,
          ctx,
        );
      }
    await auditWorkflow(
      user,
      user.patientId!,
      "abha.disconnected",
      c.id,
      "identity-link",
      "",
      ctx,
    );
    return { status: "disconnected" };
  });
}
export async function resolvePatient(
  user: User,
  body: any,
  ctx: AuditContext = {},
) {
  await requireDoctorTrust(user);
  let connection: Entity | undefined;
  if (body?.qr) {
    const decoded = validateIdentityQR(String(body.qr));
    connection = await store.get("identity", decoded.connectionId);
    if (connection?.kind !== "abhaConnection") connection = undefined;
  } else {
    const identifier = validateABHA(String(body?.identifier || ""));
    const candidates = await store.list("identity", "abhaConnection");
    connection = candidates.find(
      (c) =>
        c.status === "connected" &&
        (c.number === identifier || c.address === identifier),
    );
    if (connection && !(await adapter().resolveABHA(identifier, connection)))
      connection = undefined;
  }
  if (
    !connection ||
    connection.status !== "connected" ||
    connection.mode !== abdmMode() ||
    !["MOCK_VERIFIED", "VERIFIED"].includes(connection.verificationStatus)
  )
    throw new NotFoundException("Patient identity could not be verified");
  if (Date.now() - Date.parse(connection.lastVerifiedAt) > 86400000)
    throw new ForbiddenException(
      "Ask the patient to refresh identity verification",
    );
  const session = entity("accessSession", connection.owner, user.tenant, {
    doctorId: user.id,
    patientId: connection.owner,
    connectionId: connection.id,
    expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
  });
  await store.put("consent", session);
  await auditWorkflow(
    user,
    connection.owner,
    body.qr ? "qr.scanned" : "identity.manual",
    session.id,
    "identity-resolution",
    "",
    ctx,
  );
  await auditWorkflow(
    user,
    connection.owner,
    "patient.resolved",
    session.id,
    "identity-resolution",
    "",
    ctx,
  );
  return {
    accessSessionId: session.id,
    name: connection.name,
    maskedABHA: maskABHA(connection.number),
    verificationStatus: connection.verificationStatus,
    identityStatus: "resolved",
    mode: connection.mode,
  };
}
export async function requestHealthInformation(
  user: User,
  body: unknown,
  ctx: AuditContext = {},
) {
  return serial(async () => {
    const { doctor, hospital } = await requireDoctorTrust(user);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        "Provide patient session, purpose, requested information, valid dates and expiry",
      );
    const b = parsed.data;
    const expiry = Date.parse(b.expiresAt);
    if (
      b.dateFrom > b.dateTo ||
      expiry <= Date.now() ||
      expiry > Date.now() + 24 * 3600000
    )
      throw new BadRequestException(
        "Use an ordered date range and an access expiry within 24 hours",
      );
    const session = await store.get("consent", b.accessSessionId);
    if (
      !session ||
      session.kind !== "accessSession" ||
      session.doctorId !== doctor.id ||
      session.tenant !== doctor.tenant ||
      Date.parse(session.expiresAt) <= Date.now()
    )
      throw new ForbiddenException("Patient resolution session is unavailable");
    const connection = await store.get("identity", session.connectionId);
    if (
      !connection ||
      connection.status !== "connected" ||
      connection.mode !== abdmMode()
    )
      throw new ForbiddenException(
        "Patient identity connection is unavailable",
      );
    if (session.requestId)
      throw new BadRequestException(
        "This patient session already has a consent request; scan again for a new request",
      );
    const request = {
      ...entity("consent", session.patientId, doctor.tenant),
      patientId: session.patientId,
      doctorId: doctor.id,
      doctorName: doctor.name,
      hospitalName: hospital.name,
      purpose: b.purpose,
      requestedScopes: [...new Set(b.requestedScopes)],
      scope: recordTypesFor(b.requestedScopes),
      fromDate: b.dateFrom,
      toDate: b.dateTo,
      validUntil: b.expiresAt,
      status: "requested",
      workflow: true,
      workflowStatus: "PENDING",
      transferStatus: "REQUEST_SENT",
      adapterMode: abdmMode(),
      correlationId: randomUUID(),
      connectionId: connection.id,
      accessSessionId: session.id,
      updatedAt: now(),
      attempts: 0,
      documentIds: [],
      sourceIds: [],
      createdAt: now(),
    } as WorkflowRequest;
    const response = await adapter().createConsentRequest(request);
    if (response.correlationId !== request.correlationId)
      throw new ServiceUnavailableException("Invalid consent service response");
    await store.put("consent", request);
    session.requestId = request.id;
    await store.put("consent", session);
    await auditWorkflow(
      user,
      request.patientId,
      "consent.requested",
      request.id,
      request.purpose,
      request.id,
      ctx,
    );
    return publicRequest(request);
  });
}
export async function visibleRequest(user: User, id: string) {
  const c = await store.get<WorkflowRequest>("consent", id);
  if (
    !c?.workflow ||
    !(
      (user.role === "patient" && user.patientId === c.patientId) ||
      (user.role === "doctor" &&
        user.id === c.doctorId &&
        user.tenant === c.tenant) ||
      (user.role === "hospital" && user.tenant === c.tenant)
    )
  )
    throw new NotFoundException("Access request not found");
  return c;
}
export async function listRequests(user: User) {
  return (
    await store.list<WorkflowRequest>(
      "consent",
      "consent",
      user.role === "patient"
        ? { owner: user.patientId! }
        : { tenant: user.tenant },
    )
  )
    .filter(
      (c) => c.workflow && (user.role !== "doctor" || c.doctorId === user.id),
    )
    .map(publicRequest);
}
export async function decideConsent(
  user: User,
  id: string,
  decision: string,
  ctx: AuditContext = {},
) {
  return serial(async () => {
    const c = await visibleRequest(user, id);
    if (user.role !== "patient" || user.patientId !== c.patientId)
      throw new ForbiddenException("Only the patient can decide");
    if (
      !["approve", "deny", "revoke"].includes(decision) ||
      (["approve", "deny"].includes(decision) &&
        c.workflowStatus !== "PENDING") ||
      (decision === "revoke" && c.workflowStatus !== "APPROVED") ||
      Date.parse(c.validUntil) <= Date.now()
    )
      throw new BadRequestException(
        "This consent decision is no longer available",
      );
    if (decision === "approve") {
      const doctor = await store.get<User>("identity", c.doctorId);
      if (!doctor) throw new ForbiddenException();
      await requireDoctorTrust(doctor);
      const connection = await store.get("identity", c.connectionId);
      if (!connection || connection.status !== "connected")
        throw new ForbiddenException("Patient connection unavailable");
    }
    c.patientDecision =
      decision === "approve"
        ? "APPROVED"
        : decision === "deny"
          ? "DENIED"
          : "REVOKED";
    c.workflowStatus = c.patientDecision as WorkflowRequest["workflowStatus"];
    c.status =
      decision === "approve"
        ? "granted"
        : decision === "deny"
          ? "denied"
          : "revoked";
    c.updatedAt = now();
    if (decision === "approve") c.transferStatus = "APPROVED";
    // Persist local denial/revocation before contacting any external service.
    await store.put("consent", c);
    if (decision === "approve")
      await store.put(
        "consent",
        entity("consentGrant", c.patientId, c.tenant, {
          parentId: c.id,
          requestId: c.id,
          doctorId: c.doctorId,
          expiresAt: c.validUntil,
          scopes: c.requestedScopes,
        }),
      );
    await auditWorkflow(
      user,
      c.patientId,
      `consent.${decision === "approve" ? "approved" : decision === "deny" ? "denied" : "revoked"}`,
      c.id,
      c.purpose,
      c.id,
      ctx,
    );
    if (decision === "revoke")
      await adapter()
        .revokeConsent(c)
        .catch(async () => {
          c.remoteRevokePending = true;
          await store.put("consent", c);
        });
    await recordEvent(
      {
        id: randomUUID(),
        requestId: c.id,
        correlationId: c.correlationId,
        timestamp: now(),
        type:
          decision === "approve"
            ? "consent.approved"
            : decision === "deny"
              ? "consent.denied"
              : "consent.revoked",
      },
      "patient",
    );
    return publicRequest(c);
  });
}
async function recordEvent(event: WorkflowEvent, origin: string) {
  await store.put(
    "consent",
    entity("webhookEvent", "", "", {
      parentId: event.requestId,
      ...event,
      eventStatus: "processed",
      origin,
    }),
  );
}
export async function handleWebhook(raw: Buffer, headers: Record<string, any>) {
  return serial(async () => {
    if (abdmMode() !== "mock")
      throw new ServiceUnavailableException(
        "Official ABDM webhook authentication is not configured",
      );
    const secret = process.env.ABDM_WEBHOOK_SECRET;
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException(
        "Webhook signing is not configured",
      );
    const stamp = String(headers["x-timestamp"] || ""),
      signature = String(headers["x-signature"] || "");
    if (
      !/^\d{13}$/.test(stamp) ||
      Math.abs(Date.now() - Number(stamp)) > 300000 ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      throw new ForbiddenException("Invalid webhook authentication");
    const expected = createHmac("sha256", secret)
      .update(stamp + ".")
      .update(raw)
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      throw new ForbiddenException("Invalid webhook authentication");
    let parsed;
    try {
      parsed = eventSchema.parse(JSON.parse(raw.toString()));
    } catch {
      throw new BadRequestException("Invalid webhook schema");
    }
    const event = parsed;
    if (Math.abs(Date.now() - Date.parse(event.timestamp)) > 300000)
      throw new BadRequestException("Stale webhook");
    const prior = await store.get("consent", event.id);
    if (prior) {
      if (prior.kind !== "webhookEvent" || prior.bodyHash !== hash(raw))
        throw new BadRequestException("Event ID collision");
      return { duplicate: true };
    }
    const c = await store.get<WorkflowRequest>("consent", event.requestId);
    if (!c?.workflow || c.adapterMode !== abdmMode())
      throw new BadRequestException("Unknown consent request");
    await adapter().handleWebhook(event, c);
    // A signed event cannot manufacture patient approval or revive a terminal grant.
    if (event.type === "consent.approved" && c.patientDecision !== "APPROVED")
      throw new ForbiddenException("No explicit patient approval");
    if (["DENIED", "REVOKED", "EXPIRED"].includes(c.workflowStatus)) {
      await store.put(
        "consent",
        entity("webhookEvent", c.patientId, c.tenant, {
          parentId: c.id,
          ...event,
          bodyHash: hash(raw),
          eventStatus: "ignored-terminal",
          origin: "signed-mock",
        }),
      );
      return { accepted: true, ignored: true, duplicate: false };
    }
    if (["consent.revoked", "consent.denied"].includes(event.type)) {
      c.workflowStatus =
        event.type === "consent.revoked" ? "REVOKED" : "DENIED";
      c.status = event.type === "consent.revoked" ? "revoked" : "denied";
    } else if (event.type === "consent.expired") {
      if (Date.parse(c.validUntil) > Date.now())
        throw new BadRequestException("Premature expiry event");
      c.workflowStatus = "EXPIRED";
      c.status = "expired";
    } else if (
      event.type === "transfer.failed" &&
      c.workflowStatus === "APPROVED"
    ) {
      c.transferStatus = "FAILED";
      c.error = "Health information service temporarily unavailable";
    } else if (
      event.type === "health.received" &&
      c.workflowStatus === "APPROVED" &&
      c.transferStatus === "DATA_REQUESTED"
    ) {
      c.nextAttemptAt = now();
    } // Fetch/validate through adapter; never ingest webhook claims directly.
    c.updatedAt = now();
    await store.put("consent", c);
    await store.put(
      "consent",
      entity("webhookEvent", c.patientId, c.tenant, {
        parentId: c.id,
        ...event,
        bodyHash: hash(raw),
        eventStatus: "processed",
        origin: "signed-mock",
      }),
    );
    await store.audit(
      "abdm-adapter",
      c.patientId,
      "webhook." + event.type,
      c.tenant,
      c.purpose,
      c.id,
      { eventId: event.id },
    );
    return { accepted: true, duplicate: false };
  });
}
async function expire(c: WorkflowRequest) {
  c.status = "expired";
  c.workflowStatus = "EXPIRED";
  c.updatedAt = now();
  await store.put("consent", c);
  await store.audit(
    "expiry-worker",
    c.patientId,
    "access.expired",
    c.tenant,
    c.purpose,
    c.id,
  );
  await recordEvent(
    {
      id: randomUUID(),
      requestId: c.id,
      correlationId: c.correlationId,
      type: "consent.expired",
      timestamp: now(),
    },
    "expiry-worker",
  );
}
export async function workflowTick() {
  return serial(async () => {
    for (const c of await store.list<WorkflowRequest>("consent", "consent")) {
      if (!c.workflow) continue;
      if (
        ["PENDING", "APPROVED"].includes(c.workflowStatus) &&
        Date.parse(c.validUntil) <= Date.now()
      ) {
        await expire(c);
        continue;
      }
      if (
        c.workflowStatus === "PENDING" &&
        c.transferStatus === "REQUEST_SENT"
      ) {
        c.transferStatus = "WAITING_FOR_PATIENT";
        c.updatedAt = now();
        await store.put("consent", c);
        continue;
      }
      if (
        c.workflowStatus !== "APPROVED" ||
        ["READY", "FAILED"].includes(c.transferStatus) ||
        (c.nextAttemptAt && Date.parse(c.nextAttemptAt) > Date.now())
      )
        continue;
      try {
        const doctor = await store.get<User>("identity", c.doctorId);
        if (!doctor) throw new ForbiddenException();
        await requireDoctorTrust(doctor);
        if (
          c.adapterMode !== abdmMode() ||
          (await adapter().getConsentStatus(c)) !== "APPROVED"
        )
          throw new ForbiddenException("Consent status cannot be verified");
        if (c.transferStatus === "APPROVED") {
          c.transferStatus = "DATA_REQUESTED";
          c.updatedAt = now();
          await store.put("consent", c);
          continue;
        }
        if (c.transferStatus === "DATA_REQUESTED") {
          const transfer = transferSchema.parse(
            await adapter().fetchHealthInformation(c),
          );
          if (transfer.correlationId !== c.correlationId)
            throw new Error("Correlation mismatch");
          // Reject an over-broad provider response as a whole before saving any record.
          for (const record of transfer.records)
            if (
              record.date < c.fromDate ||
              record.date > c.toDate ||
              !record.informationScopes.every((s) =>
                c.requestedScopes.includes(s),
              )
            )
              throw new Error("Record outside consent scope");
          if (Date.parse(c.validUntil) <= Date.now()) {
            await expire(c);
            continue;
          }
          for (const record of transfer.records) {
            const bytes = Buffer.from(
              record.content,
              record.encoding === "base64" ? "base64" : "utf8",
            );
            let doc = (
              await store.list<MedicalDocument>("clinical", "document", {
                owner: c.patientId,
              })
            ).find((d) => d.hash === hash(bytes));
            if (!doc)
              doc = await ingest(
                c.patientId,
                record.name,
                record.mime,
                bytes,
                record.recordType,
                record.date,
              );
            doc.retrievalConsents = [
              ...new Set([...(doc.retrievalConsents || []), c.id]),
            ];
            doc.informationScopes = record.informationScopes;
            doc.sourceProvider = record.source;
            doc.synthetic = c.adapterMode === "mock";
            await store.put("clinical", doc);
            if (!c.documentIds.includes(doc.id)) c.documentIds.push(doc.id);
            const existing = (
              await store.list("clinical", "healthRecordSource", {
                owner: c.patientId,
              })
            ).find((s) => s.documentId === doc!.id && s.consentId === c.id);
            if (!existing) {
              const source = entity(
                "healthRecordSource",
                c.patientId,
                c.tenant,
                {
                  parentId: doc.id,
                  documentId: doc.id,
                  consentId: c.id,
                  provider: record.source,
                  providerRecordId: record.id,
                  sourceDate: record.date,
                  sourceHash: doc.hash,
                },
              );
              await store.put("clinical", source);
              c.sourceIds.push(source.id);
            }
          }
          c.transferStatus = "DATA_RECEIVED";
          c.lastSuccessfulSync = now();
          c.updatedAt = now();
          await store.put("consent", c);
          await store.audit(
            "abdm-adapter",
            c.patientId,
            "data.retrieved",
            c.tenant,
            c.purpose,
            c.id,
            { count: c.documentIds.length, mode: c.adapterMode },
          );
          await recordEvent(
            {
              id: randomUUID(),
              requestId: c.id,
              correlationId: c.correlationId,
              timestamp: now(),
              type: "health.received",
            },
            "adapter",
          );
          continue;
        }
        if (c.transferStatus === "DATA_RECEIVED") {
          c.transferStatus = "PROCESSING";
          await store.put("consent", c);
          continue;
        }
        if (c.transferStatus === "PROCESSING") {
          for (const id of c.documentIds) {
            const doc = await store.get<MedicalDocument>("clinical", id);
            if (doc && doc.status !== "completed") await processDocument(id);
          }
          const data = await authorizedFacts(
            doctor,
            c.patientId,
            c.id,
            c.purpose,
          );
          let result;
          try {
            result = await aiProvider().summarize(data.facts, data.docs);
            c.summaryStatus = "ready";
          } catch {
            result = buildBrief(data.facts, data.docs);
            c.summaryStatus = "fallback";
          }
          // Derived snapshots never bypass policy: read endpoints recompute from authorized facts.
          await store.put(
            "clinical",
            entity("emergencyBrief", c.patientId, c.tenant, {
              consentId: c.id,
              factIds: result.facts.map((f) => f.id),
              provider: aiProvider().name,
              status: c.summaryStatus,
            }),
          );
          for (const conflict of result.conflicts)
            await store.put(
              "clinical",
              entity("conflict", c.patientId, c.tenant, {
                consentId: c.id,
                ...conflict,
                id: randomUUID(),
              }),
            );
          for (const f of data.facts)
            for (const e of f.evidence)
              await store.put(
                "clinical",
                entity("evidenceReference", c.patientId, c.tenant, {
                  parentId: f.id,
                  factId: f.id,
                  ...e,
                }),
              );
          c.transferStatus = "READY";
          c.updatedAt = now();
          c.error = undefined;
          await store.put("consent", c);
        }
      } catch {
        c.attempts++;
        c.error = "Health information service temporarily unavailable";
        c.transferStatus = c.attempts >= 3 ? "FAILED" : c.transferStatus;
        c.nextAttemptAt = new Date(
          Date.now() + Math.min(30000, 1000 * 2 ** c.attempts),
        ).toISOString();
        c.updatedAt = now();
        await store.put("consent", c);
        await store.audit(
          "workflow-worker",
          c.patientId,
          "data-transfer.failed",
          c.tenant,
          c.purpose,
          c.id,
          { attempt: c.attempts },
        );
      }
    }
  });
}
let interval: NodeJS.Timeout | undefined;
let ticking = false;
export function startWorkflow() {
  interval = setInterval(
    () => {
      if (ticking) return;
      ticking = true;
      workflowTick()
        .catch(() => console.error("Workflow tick failed"))
        .finally(() => {
          ticking = false;
        });
    },
    Number(process.env.WORKFLOW_TICK_MS || 1000),
  );
  interval.unref();
}
export async function stopWorkflow() {
  if (interval) clearInterval(interval);
  await serialQueue;
}
export async function retryRetrieval(user: User, id: string) {
  return serial(async () => {
    const c = await visibleRequest(user, id);
    if (user.role !== "doctor" || c.doctorId !== user.id)
      throw new ForbiddenException();
    await authorize(user, c.patientId, c.id, c.purpose);
    if (c.transferStatus !== "FAILED")
      throw new BadRequestException("Only failed transfers can be retried");
    c.transferStatus = "APPROVED";
    c.attempts = 0;
    c.nextAttemptAt = undefined;
    c.error = undefined;
    await store.put("consent", c);
    return publicRequest(c);
  });
}
