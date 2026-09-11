# Render synthetic demo deployment

Status: configuration prepared and tested locally. No hosted service has been created yet.

## Recommended setup

One Render Node web service serves the built React frontend and NestJS API on the same HTTPS origin. One persistent disk stores the encrypted SQLite vaults and encrypted original documents. One instance runs the processing loop and live consent updates. This preserves the existing application architecture.

Render persistent disks require a paid service. Review the price displayed by Render before creating it. The checked-in render.yaml requests a 0.5c-512mb instance in Singapore and a 1 GB disk; increase memory if actual load requires it. No paid resources are provisioned by preparing these files. Automatic deployments are disabled.

Vercel is optional for a separate frontend but would require same-origin API proxying and deployment coordination. Supabase Postgres can be a later database migration; the current demo profile intentionally uses the existing SQLite vaults. Cloudinary is unnecessary for the encrypted clinical-source pipeline. Existing private object storage interfaces can be integrated later.

## Deploy

1. Push the reviewed deployment changes to https://github.com/pratham9766/G1 using your authorized GitHub account. Do not commit data/, .env, development keys, logs or artifacts.
2. Sign into https://dashboard.render.com and choose New → Blueprint. Connect the repository and select the intended branch.
3. Render reads render.yaml. Review the service and disk price, then create the Blueprint only if acceptable.
4. Keep the generated G1_DEMO_MASTER_KEY stable across deployments. It derives four separate encryption/lookup keys and is not written to a development-key file. Losing/changing it makes existing encrypted data unreadable. Keep it in Render secrets; do not paste it into chat or commit it.
5. Startup obtains its HTTPS origin from RENDER_EXTERNAL_URL. For a custom domain, set APP_ORIGIN to the exact HTTPS origin without a path. The disk is available at startup; migrations and idempotent seeding run then, not during build.
6. Wait for health check /api/v1/health to pass, then open the HTTPS URL. Check the patient and doctor flow in separate browser profiles, including camera access, QR upload, consent, retrieval, evidence and live revocation.

## Demo accounts

Patient aarav@g1.demo, doctor meera@g1.demo, hospital admin admin@g1.demo. Password for all: G1-Workflow-Demo-2026!.

Connect synthetic ABHA address aarav.sharma@abdm from the patient dashboard. These shared demonstration accounts are not suitable for personal or real health information. No consent is pre-approved.

## Hosted safeguards

G1_HOSTED_DEMO=true is required by npm run start:demo. The profile requires HTTPS, mock ABDM, local clinical processing, a stable master secret and a configured data directory. It sets Secure/HttpOnly/SameSite=Strict cookies, accepts only the configured browser origin for mutations, and trusts one hosting reverse-proxy hop. The service should be reachable only through that trusted proxy.

Registration, arbitrary document uploads and external integration callbacks are disabled in the hosted profile. Synthetic records are retrieved through the consent-controlled mock adapter. Local development keeps existing upload and registration functionality. Existing production startup remains blocked; development mode here is an explicitly restricted demonstration, not approval for healthcare production use.

The demo shares account state among viewers. Do not enter real health information in notes or profile fields. One instance and its persistent disk are required. Do not enable autoscaling, attach an existing clinical database, or copy local patient data into the demo.

## Required configuration

All nonsecret defaults are in render.yaml. Render generates G1_DEMO_MASTER_KEY. RENDER_EXTERNAL_URL is supplied by Render. Optional APP_ORIGIN overrides the public origin for a custom domain. Use npm run start:demo, not npm start, for this hosted profile. Node 22.20.0 and npm ci --include=dev are used because the server runs through tsx.

## Verification and limitations

Local configuration tests validate stable distinct keys and reject insecure/invalid settings. A hosted-profile API test checks automatic seeding, absence of a local development-key file, Secure cookies, blocked imports/registration and untrusted-origin rejection. Existing clinical/consent regressions also run. Actual Render deployment, TLS/proxy behavior, disk persistence over redeploy, public browser tests and load checks remain to be verified after account access and deployment approval.

References: https://render.com/docs/web-services, https://render.com/docs/disks, https://render.com/docs/blueprint-spec, https://render.com/docs/environment-variables.

Local validation: build passed; all 31 API/clinical tests passed, including hosted-profile startup and security checks. Deployment has not yet been performed.
