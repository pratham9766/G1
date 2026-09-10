import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { store } from "./store";
import type { Consent, Fact, MedicalDocument, User } from "./types";
export function active(c: Consent, now = Date.now()) {
  return c.status === "granted" && Date.parse(c.validUntil) > now;
}
export function inScope(c: Consent, d: MedicalDocument, f?: Fact) {
  const date = f?.effectiveDate || d.recordDate;
  return (
    c.scope.includes(d.recordType) && date >= c.fromDate && date <= c.toDate
  );
}
export async function authorize(
  user: User,
  patientId: string,
  consentId?: string,
  purpose?: string,
): Promise<Consent | undefined> {
  if (user.disabled) throw new ForbiddenException("Account is disabled");
  if (user.role === "patient" && user.patientId === patientId) return;
  const c = consentId
    ? await store.get<Consent>("consent", consentId)
    : undefined;
  if (
    user.role !== "doctor" ||
    !user.verified ||
    !c ||
    c.patientId !== patientId ||
    c.doctorId !== user.id ||
    c.tenant !== user.tenant ||
    !active(c) ||
    c.purpose !== purpose
  ) {
    await store.audit(
      user.id,
      patientId,
      "access.denied",
      user.tenant,
      purpose || "",
      consentId || "",
    );
    throw new ForbiddenException(
      "Active consent with matching purpose, scope and hospital affiliation is required",
    );
  }
  return c;
}
export async function authorizedFacts(
  user: User,
  patientId: string,
  consentId?: string,
  purpose?: string,
) {
  const c = await authorize(user, patientId, consentId, purpose);
  const docs = (
    await store.list<MedicalDocument>("clinical", "document", {
      owner: patientId,
    })
  ).filter((d) => d.status === "completed");
  const facts = (
    await store.list<Fact>("clinical", "fact", { owner: patientId })
  ).filter(
    (f) =>
      f.evidence.length &&
      f.evidence.every((e) => {
        const d = docs.find((x) => x.id === e.documentId);
        return d && d.hash === e.sourceHash && (!c || inScope(c, d, f));
      }),
  );
  await store.audit(
    user.id,
    patientId,
    "clinical.read",
    user.tenant,
    purpose || "self",
    c?.id || "",
    { factCount: facts.length },
  );
  return { c, facts, docs: docs.filter((d) => !c || inScope(c, d)) };
}
export async function requireDocument(
  user: User,
  id: string,
  consentId?: string,
  purpose?: string,
) {
  const d = await store.get<MedicalDocument>("clinical", id);
  if (!d) throw new NotFoundException("Document not found");
  const c = await authorize(user, d.patientId, consentId, purpose);
  if (c) {
    const facts = await store.list<Fact>("clinical", "fact", {
      owner: d.patientId,
    });
    if (
      !inScope(c, d) ||
      facts
        .filter((f) => f.evidence.some((e) => e.documentId === d.id))
        .some((f) => !inScope(c, d, f))
    )
      throw new ForbiddenException(
        "Original source extends beyond consent date scope",
      );
  }
  return d;
}
