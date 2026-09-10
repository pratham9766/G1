import { test, expect, Page } from "@playwright/test";
import { resolve } from "node:path";
async function login(page: Page, role: string) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(`${role}@g1.local`);
  await page.getByLabel("Password", { exact: true }).fill("G1-Synthetic-2026!");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
test("patient dashboard, upload, profile and mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "patient");
  await expect(
    page.getByRole("heading", { name: "Hello, Aarav." }),
  ).toBeVisible();
  await expect(
    page.getByText("discharge-summary.txt", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/g1-patient-overview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Medical records", exact: true })
    .click();
  await page
    .getByLabel("Select a file")
    .setInputFiles(resolve("fixtures/fhir-bundle.json"));
  await page.getByLabel("Record type").selectOption("laboratory");
  await page.getByLabel("Record date", { exact: true }).fill("2026-08-12");
  await page.getByRole("button", { name: "Upload & process" }).click();
  await expect(
    page.getByText("fhir-bundle.json", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("3 extracted facts", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Profile & privacy" }).click();
  await page
    .getByLabel("Emergency profile (patient-declared)")
    .fill("Synthetic emergency contact: test contact");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText("Profile saved");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, Aarav." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "artifacts/g1-mobile-overview.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("clinician brief, conflict inspection and evidence source", async ({
  page,
}) => {
  await login(page, "doctor");
  await expect(
    page.getByRole("heading", { name: "Aarav Mehta", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Evidence", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Source evidence" }),
  ).toBeVisible();
  await expect(
    page.getByText("ORIGINAL SOURCE EXCERPT", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/g1-doctor-brief.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close evidence" }).click();
  await page.getByRole("button", { name: /Conflicts \(/ }).click();
  await expect(
    page.getByRole("heading", { name: "Allergy records disagree" }).first(),
  ).toBeVisible();
});
test("hospital administration is separate from clinical viewing", async ({
  page,
}) => {
  await login(page, "hospital");
  await expect(
    page.getByRole("heading", { name: "Hospital overview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clinicians", exact: true }).click();
  await expect(page.getByText("Dr. Mira Shah", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Departments", exact: true }).click();
  await page.getByLabel("Department name").fill("Synthetic cardiology");
  await page.getByRole("button", { name: "Add department" }).click();
  await expect(
    page.getByText("Synthetic cardiology", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  await expect(
    page.getByText("Not configured", { exact: true }).first(),
  ).toBeVisible();
});
test("patient revocation removes clinician access on refresh", async ({
  browser,
}) => {
  const pContext = await browser.newContext(),
    dContext = await browser.newContext();
  const patient = await pContext.newPage(),
    doctor = await dContext.newPage();
  await login(patient, "patient");
  await login(doctor, "doctor");
  await expect(
    doctor.getByRole("heading", { name: "Aarav Mehta", exact: true }),
  ).toBeVisible();
  await patient
    .getByRole("button", { name: "Consent & access", exact: true })
    .click();
  await patient
    .getByRole("button", { name: "Revoke access", exact: true })
    .click();
  await expect(patient.getByRole("status")).toContainText("Access revoked");
  await doctor.getByRole("button", { name: "Refresh history" }).click();
  await expect(doctor.getByRole("alert")).toContainText("Active consent");
  await expect(
    doctor.getByRole("button", { name: "Evidence", exact: true }),
  ).toHaveCount(0);
  await pContext.close();
  await dContext.close();
});
