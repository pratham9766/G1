import { randomUUID } from "node:crypto";
import { store } from "../store";
import { createUser } from "../auth";
import { lookup, production } from "../security";
import { abdmMode } from "./adapters";
export async function seedWorkflow() {
  if (production || abdmMode() !== "mock")
    throw new Error(
      "Workflow fixtures are available only in mock development mode",
    );
  // Caller initializes storage, allowing tests to seed without replacing their connection.
  if (await store.get("identity", lookup("aarav@g1.demo"))) return;
  const hospitalId = randomUUID(),
    at = new Date().toISOString();
  await store.put("identity", {
    id: hospitalId,
    kind: "hospital",
    owner: hospitalId,
    tenant: hospitalId,
    name: "G1 Demo Hospital",
    verified: true,
    synthetic: true,
    disabled: false,
    hfrId: "DEMO-HFR-001",
    facilityId: "DEMO-FACILITY-001",
    verificationProvider: "G1 synthetic simulator",
    verifiedAt: at,
  });
  await store.put("identity", {
    id: randomUUID(),
    kind: "hospitalVerification",
    owner: hospitalId,
    tenant: hospitalId,
    parentId: hospitalId,
    hfrId: "DEMO-HFR-001",
    facilityId: "DEMO-FACILITY-001",
    status: "MOCK_VERIFIED",
    provider: "G1 synthetic simulator",
    verifiedAt: at,
  });
  const password = "G1-Workflow-Demo-2026!";
  const patient = await createUser(
    "aarav@g1.demo",
    password,
    "Aarav Sharma",
    "patient",
    "",
    {
      synthetic: true,
      dob: "1986-04-18",
      sex: "male",
      demoABHA: { number: "90000000001234", address: "aarav.sharma@abdm" },
    },
  );
  const doctor = await createUser(
    "meera@g1.demo",
    password,
    "Dr. Meera Kulkarni",
    "doctor",
    hospitalId,
    {
      verified: true,
      synthetic: true,
      professionalRef: "DEMO-HPR-001",
      hprId: "DEMO-HPR-001",
      registrationNumber: "DEMO-REG-001",
      specialty: "Emergency medicine",
      verificationProvider: "G1 synthetic simulator",
      verifiedAt: at,
    },
  );
  await store.put("identity", {
    id: randomUUID(),
    kind: "doctorVerification",
    owner: doctor.id,
    tenant: hospitalId,
    parentId: doctor.id,
    hprId: "DEMO-HPR-001",
    registrationNumber: "DEMO-REG-001",
    specialty: "Emergency medicine",
    status: "MOCK_VERIFIED",
    provider: "G1 synthetic simulator",
    verifiedAt: at,
  });
  await createUser(
    "admin@g1.demo",
    password,
    "G1 Demo Administrator",
    "hospital",
    hospitalId,
    { verified: true, synthetic: true },
  );
  await store.audit(
    "workflow-fixtures",
    patient.patientId!,
    "demo.created",
    hospitalId,
    "synthetic-demo",
  );
  // No pre-granted consent, connected ABHA, or preloaded clinical data.
  console.log(
    "Synthetic workflow accounts: aarav@g1.demo, meera@g1.demo, admin@g1.demo. No consent is pre-approved.",
  );
}
if (require.main === module)
  store
    .init()
    .then(seedWorkflow)
    .then(() => store.close())
    .catch(() => {
      console.error("Workflow demo setup failed");
      process.exitCode = 1;
    });
