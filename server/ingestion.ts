import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  unlink,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Queue, Worker } from "bullmq";
import { store } from "./store";
import { dataDir, hash, seal, unseal, production } from "./security";
import { extractText, extractFhir, EXTRACTOR_VERSION } from "./clinical";
import type { MedicalDocument, RecordType } from "./types";
const s3 = process.env.S3_BUCKET
  ? new S3Client({
      region: process.env.S3_REGION || "ap-south-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: !!process.env.S3_ENDPOINT,
    })
  : undefined;
const bucket = process.env.S3_BUCKET;
async function saveObject(id: string, bytes: Buffer) {
  const encrypted = seal(bytes);
  if (s3)
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: id,
        Body: encrypted,
        ContentType: "application/octet-stream",
        ServerSideEncryption: "AES256",
      }),
    );
  else {
    await mkdir(resolve(dataDir, "objects"), { recursive: true });
    await writeFile(resolve(dataDir, "objects", id), encrypted, {
      mode: 0o600,
    });
  }
}
export async function readObject(id: string) {
  const encrypted = s3
    ? await (
        await s3.send(new GetObjectCommand({ Bucket: bucket, Key: id }))
      ).Body!.transformToString()
    : await readFile(resolve(dataDir, "objects", id), "utf8");
  return unseal(encrypted);
}
export async function deleteObject(id: string) {
  if (s3) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: id }));
  else
    await unlink(resolve(dataDir, "objects", id)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
}
export function validateFile(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new BadRequestException("Upload a nonempty file under 10 MB");
  const text = bytes.subarray(0, 1024).toString("utf8");
  const valid =
    (mime === "application/pdf" &&
      bytes.subarray(0, 5).toString() === "%PDF-") ||
    (mime === "image/png" &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === "image/jpeg" &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255) ||
    (["application/json", "application/fhir+json"].includes(mime) &&
      /^\s*\{/.test(text)) ||
    (mime === "text/plain" && !bytes.includes(0));
  if (!valid)
    throw new BadRequestException(
      "File content does not match a supported PDF, PNG, JPEG, FHIR JSON or text format",
    );
  if (
    mime === "image/png" &&
    (bytes.length < 24 ||
      bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 40_000_000)
  )
    throw new BadRequestException(
      "Image exceeds the 40 megapixel limit or is malformed",
    );
  if (mime === "image/jpeg") {
    let i = 2,
      found = false;
    while (i + 8 < bytes.length) {
      if (bytes[i] !== 255) break;
      const marker = bytes[i + 1];
      const len = bytes.readUInt16BE(i + 2);
      if (len < 2) break;
      if ([192, 193, 194].includes(marker)) {
        found = true;
        if (bytes.readUInt16BE(i + 5) * bytes.readUInt16BE(i + 7) > 40_000_000)
          throw new BadRequestException("Image exceeds 40 megapixels");
        break;
      }
      i += 2 + len;
    }
    if (!found)
      throw new BadRequestException("JPEG dimensions could not be validated");
  }
  if (
    mime === "application/pdf" &&
    /\/JavaScript|\/JS\s|\/Launch|\/EmbeddedFile|\/OpenAction/i.test(
      bytes.toString("latin1"),
    )
  )
    throw new BadRequestException(
      "Active or embedded PDF content is not accepted",
    );
}
async function scan(bytes: Buffer) {
  if (!process.env.CLAMAV_HOST) {
    if (production)
      throw new ServiceUnavailableException(
        "Malware scanner is not configured",
      );
    return;
  }
  await new Promise<void>((ok, no) => {
    const socket = createConnection({
      host: process.env.CLAMAV_HOST!,
      port: Number(process.env.CLAMAV_PORT || 3310),
    });
    let output = "";
    socket.setTimeout(15000, () =>
      socket.destroy(new Error("Scanner timeout")),
    );
    socket.on("error", no);
    socket.on("data", (b) => (output += b.toString()));
    socket.on("end", () =>
      output.includes("stream: OK")
        ? ok()
        : no(new BadRequestException("Upload rejected by malware scanner")),
    );
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < bytes.length; i += 65536) {
        const b = bytes.subarray(i, i + 65536);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(b.length);
        socket.write(size);
        socket.write(b);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
let queue: Queue | undefined;
let worker: Worker | undefined;
let timer: NodeJS.Timeout | undefined;
let running = false;
export async function enqueue(d: MedicalDocument) {
  if (queue)
    await queue.add(
      "parse",
      { id: d.id },
      {
        jobId: d.id,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
}
export async function ingest(
  patientId: string,
  name: string,
  mime: string,
  bytes: Buffer,
  recordType: RecordType,
  recordDate: string,
) {
  validateFile(bytes, mime);
  await scan(bytes);
  const digest = hash(bytes);
  const existing = (
    await store.list<MedicalDocument>("clinical", "document", {
      owner: patientId,
    })
  ).find((d) => d.hash === digest);
  if (existing)
    throw new BadRequestException("This record has already been uploaded");
  const id = randomUUID();
  const d: MedicalDocument = {
    id,
    kind: "document",
    owner: patientId,
    tenant: "",
    patientId,
    name: name.slice(0, 120).replace(/[\\/\x00-\x1f]/g, "_"),
    mime,
    recordType,
    recordDate,
    hash: digest,
    receivedAt: new Date().toISOString(),
    status: "queued",
    attempts: 0,
    storageKey: id,
    scanner: process.env.CLAMAV_HOST ? "clamav" : "not-configured-development",
  };
  await saveObject(id, bytes);
  await store.put("clinical", d);
  await enqueue(d);
  return d;
}
export async function processDocument(id: string) {
  const d = await store.get<MedicalDocument>("clinical", id);
  if (!d || ["completed", "deleting"].includes(d.status)) return;
  d.status = "processing";
  d.attempts++;
  await store.put("clinical", d);
  try {
    const bytes = await readObject(d.storageKey);
    if (hash(bytes) !== d.hash)
      throw new Error("Source integrity check failed");
    let facts;
    if (d.mime.includes("json"))
      facts = extractFhir(JSON.parse(bytes.toString()), d);
    else {
      let pages: string[];
      if (d.mime === "application/pdf") {
        pages = await parsePdf(bytes);
        if (!pages.join("").trim())
          throw new Error(
            "Scanned PDF requires OCR; upload searchable PDF or configure a private OCR pipeline",
          );
      } else if (d.mime.startsWith("image/")) {
        if (!process.env.OCR_COMMAND)
          throw new Error(
            "Private OCR is not configured; upload a searchable PDF, text or FHIR record",
          );
        const dir = await mkdtemp(join(tmpdir(), "g1-ocr-"));
        try {
          const input = join(
            dir,
            d.mime === "image/png" ? "input.png" : "input.jpg",
          );
          await writeFile(input, bytes, { mode: 0o600 });
          const out = await promisify(execFile)(
            process.env.OCR_COMMAND,
            [input],
            { timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
          );
          pages = [out.stdout];
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      } else pages = [bytes.toString("utf8")];
      facts = extractText(pages, d);
    }
    // Stable per-document IDs make interrupted processing retries idempotent.
    for (let i = 0; i < facts.length; i++) {
      facts[i].id = hash(`${d.id}:${i}`);
      await store.put("clinical", facts[i]);
    }
    d.status = "completed";
    d.extractor = EXTRACTOR_VERSION;
    d.factCount = facts.length;
    d.error = undefined;
    await store.put("clinical", d);
    await store.put("clinical", {
      id: randomUUID(),
      kind: "notification",
      owner: d.patientId,
      tenant: "",
      message: "Record processing completed",
      createdAt: new Date().toISOString(),
    });
    await store.audit(
      "processor",
      d.patientId,
      "document.processed",
      "",
      "",
      "",
      {
        documentId: d.id,
        factCount: facts.length,
        extractor: EXTRACTOR_VERSION,
      },
    );
  } catch (e) {
    d.status = "failed";
    d.error =
      e instanceof Error && /OCR|pages|FHIR|integrity/.test(e.message)
        ? e.message
        : "Record could not be parsed safely. Check the file and retry.";
    await store.put("clinical", d);
    throw e;
  }
}
export async function startProcessing() {
  if (process.env.REDIS_URL) {
    const u = new URL(process.env.REDIS_URL);
    const connection = {
      host: u.hostname,
      port: Number(u.port || 6379),
      password: u.password || undefined,
      tls: u.protocol === "rediss:" ? {} : undefined,
    };
    queue = new Queue("g1-documents", { connection });
    worker = new Worker(
      "g1-documents",
      async (job) => {
        await processDocument(job.data.id);
      },
      { connection, concurrency: 2 },
    );
    worker.on("error", () => console.error("Document queue unavailable"));
  } else {
    timer = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        for (const d of await store.list<MedicalDocument>(
          "clinical",
          "document",
        ))
          if (d.status === "queued")
            await processDocument(d.id).catch(() => {});
      } finally {
        running = false;
      }
    }, 1000);
    timer.unref();
  }
  for (const d of await store.list<MedicalDocument>("clinical", "document"))
    if (d.status === "processing") {
      d.status = "queued";
      await store.put("clinical", d);
    }
  if (queue)
    for (const d of await store.list<MedicalDocument>("clinical", "document"))
      if (d.status === "queued") await enqueue(d);
}
export async function stopProcessing() {
  if (timer) clearInterval(timer);
  await worker?.close();
  await queue?.close();
}
export async function parsePdf(bytes: Buffer): Promise<string[]> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=128", resolve(__dirname, "pdf-parser.mjs")],
      {
        windowsHide: true,
        env: {
          SystemRoot: process.env.SystemRoot,
          PATH: process.env.PATH,
          TEMP: process.env.TEMP,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const output: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PDF parser timed out"));
    }, 30000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        child.kill();
        reject(new Error("PDF output limit exceeded"));
      } else output.push(chunk);
    });
    child.stderr.resume();
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(new Error("PDF could not be parsed safely"));
      try {
        resolveResult(JSON.parse(Buffer.concat(output).toString()));
      } catch {
        reject(new Error("Invalid PDF parser output"));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(bytes);
  });
}
