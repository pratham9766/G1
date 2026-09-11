import { ForbiddenException } from "@nestjs/common";
import { store } from "../store";
import type { User } from "../types";
export async function requireDoctorTrust(actor: User) {
  const doctor = await store.get<User>("identity", actor.id);
  const hospital = doctor?.tenant
    ? await store.get("identity", doctor.tenant)
    : undefined;
  if (
    !doctor ||
    doctor.role !== "doctor" ||
    doctor.disabled ||
    !doctor.verified ||
    !doctor.tenant ||
    !hospital ||
    hospital.kind !== "hospital" ||
    hospital.disabled ||
    hospital.verified !== true
  )
    throw new ForbiddenException(
      "Doctor verification required. Your professional identity and associated hospital must be verified and active before requesting patient health information.",
    );
  return { doctor, hospital };
}
