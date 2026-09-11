import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { store } from "./store";
import { createUser } from "./auth";
import { lookup, production } from "./security";
import { ingest, processDocument } from "./ingestion";
import type { User, Consent } from "./types";
export async function seed() {
  if (production) throw new Error("Synthetic seeds are disabled in production");
  await store.init();
  if (await store.get("identity", lookup("patient@g1.local"))) {
    console.log("Synthetic accounts already exist. No data overwritten.");
    return;
  }
  const tenant = randomUUID();
  await store.put("identity", {
    id: tenant,
    kind: "hospital",
    owner: tenant,
    tenant,
    name: "G1 Demonstration Hospital",
    status: "sandbox",
    verified: true,
    synthetic: true,
    verificationProvider: "G1 synthetic simulator",
  });
  await store.put("identity", {
    id: randomUUID(),
    kind: "department",
    owner: tenant,
    tenant,
    name: "Emergency medicine",
  });
  const password = "G1-Synthetic-2026!";
  const patient = await createUser("patient@g1.local", password, "Aarav Mehta");
  const doctor = await createUser(
    "doctor@g1.local",
    password,
    "Dr. Mira Shah",
    "doctor",
    tenant,
    {
      verified: true,
      professionalRef: "SYNTHETIC-HPR-001",
      department: "Emergency medicine",
    },
  );
  await createUser(
    "hospital@g1.local",
    password,
    "Hospital Administrator",
    "hospital",
    tenant,
    { verified: true },
  );
  const consent: Consent = {
    id: randomUUID(),
    kind: "consent",
    owner: patient.patientId!,
    tenant,
    patientId: patient.patientId!,
    doctorId: doctor.id,
    doctorName: doctor.name,
    purpose: "emergency-history",
    scope: [
      "discharge",
      "prescription",
      "diagnostic",
      "laboratory",
      "hospital",
    ],
    fromDate: "2000-01-01",
    toDate: "2030-12-31",
    validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
    status: "granted",
    createdAt: new Date().toISOString(),
    syntheticFixture: true,
  };
  await store.put("consent", consent);
  for (const [name, type, day] of [
    ["discharge-summary.txt", "discharge", "2026-08-12"],
    ["follow-up.txt", "hospital", "2026-09-01"],
  ] as const) {
    const d = await ingest(
      patient.patientId!,
      name,
      "text/plain",
      await readFile(`fixtures/${name}`),
      type,
      day,
    );
    await processDocument(d.id);
  }
  await store.audit(
    "synthetic-seed",
    patient.patientId!,
    "fixture.created",
    tenant,
    "synthetic-demo",
    consent.id,
  );
  console.log(
    "Synthetic accounts created: patient@g1.local, doctor@g1.local, hospital@g1.local",
  );
  console.log("Demo password: G1-Synthetic-2026!");
  console.log(`Synthetic patient reference: ${patient.patientId}`);
}
if (require.main === module)
  seed()
    .then(() => store.close())
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
