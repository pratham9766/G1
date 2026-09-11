import { test, expect, Page } from "@playwright/test";
const password = "G1-Workflow-Demo-2026!";
async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
test(
  "complete web QR image → live patient consent → retrieval → evidence → revocation",
  { tag: "@workflow" },
  async ({ browser }) => {
    const pc = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      dc = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
    const patient = await pc.newPage(),
      doctor = await dc.newPage();
    const errors: string[] = [];
    patient.on("pageerror", (e) => errors.push(e.message));
    doctor.on("pageerror", (e) => errors.push(e.message));
    await signIn(patient, "aarav@g1.demo");
    await expect(
      patient.getByRole("heading", { name: "Connected Health Identity" }),
    ).toBeVisible();
    await patient
      .getByRole("button", { name: "Connect ABHA", exact: true })
      .click();
    await patient
      .getByLabel("ABHA address or number", { exact: true })
      .fill("aarav.sharma@abdm");
    await patient
      .getByRole("button", { name: "Connect / Retry verification" })
      .click();
    await expect(
      patient.getByText("Demo verified · not verified by NHA"),
    ).toBeVisible();
    const qr = patient.getByAltText(
      "G1 patient identity QR. Contains no clinical records.",
    );
    await expect(qr).toBeVisible();
    const image = Buffer.from(
      (await qr.getAttribute("src"))!.split(",")[1],
      "base64",
    );
    await patient.screenshot({
      path: "artifacts/g1-connected-identity.png",
      fullPage: true,
    });
    await signIn(doctor, "meera@g1.demo");
    await doctor
      .getByRole("button", { name: "Scan Patient ABHA QR", exact: true })
      .click();
    await doctor.getByLabel("Upload QR image", { exact: true }).setInputFiles({
      name: "g1-identity.png",
      mimeType: "image/png",
      buffer: image,
    });
    await expect(
      doctor.getByRole("heading", { name: "Aarav Sharma", exact: true }),
    ).toBeVisible();
    await expect(doctor.getByText("Penicillin", { exact: false })).toHaveCount(
      0,
    );
    await doctor.getByLabel("Time range", { exact: true }).selectOption("all");
    for (const label of [
      "Allergies",
      "Current medications",
      "Diagnoses",
      "Procedures",
      "Lab results",
      "Discharge summaries",
      "Imaging reports",
      "Immunization history",
      "Previous encounters",
    ])
      await doctor.getByRole("checkbox", { name: label, exact: true }).check();
    await doctor
      .getByRole("button", { name: "Request Health Information", exact: true })
      .click();
    await expect(
      doctor.getByText("Waiting for patient approval…", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await patient
      .getByRole("button", { name: "Consent & access", exact: true })
      .click();
    await expect(
      patient.getByRole("heading", {
        name: "Health Information Access Request",
      }),
    ).toBeVisible();
    await patient
      .getByRole("button", { name: "Grant Access", exact: true })
      .click();
    await expect(
      doctor.getByRole("button", { name: "Open G1 emergency brief" }),
    ).toBeVisible({ timeout: 30000 });
    await doctor
      .getByRole("button", { name: "Open G1 emergency brief" })
      .click();
    await expect(
      doctor.getByText("Warfarin 5 mg daily", { exact: true }),
    ).toBeVisible();
    await doctor
      .getByRole("button", { name: "Evidence", exact: true })
      .first()
      .click();
    await expect(
      doctor.getByRole("heading", { name: "Source evidence" }),
    ).toBeVisible();
    await doctor.screenshot({
      path: "artifacts/g1-workflow-emergency-brief.png",
      fullPage: true,
    });
    patient.once("dialog", (d) => d.accept());
    await patient.getByRole("button", { name: "Revoke active access" }).click();
    await expect(
      doctor.getByText("Warfarin 5 mg daily", { exact: true }),
    ).toHaveCount(0, { timeout: 10000 });
    await expect(
      doctor.getByRole("button", { name: "Evidence", exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
    await pc.close();
    await dc.close();
  },
);
test("camera permission denial leaves a working manual fallback", async ({
  page,
}) => {
  await signIn(page, "meera@g1.demo");
  await page
    .getByRole("button", { name: "Scan Patient ABHA QR", exact: true })
    .click();
  await page.addInitScript(() => {});
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () => Promise.reject(new Error("denied")),
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Start camera scan" }).click();
  await expect(page.getByRole("alert")).toContainText("Camera unavailable");
  await expect(page.getByLabel("Manual ABHA address / number")).toBeVisible();
});
