import React, { useEffect, useRef, useState, FormEvent } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {
  Camera,
  QrCode,
  ShieldCheck,
  LoaderCircle,
  X,
  RefreshCw,
  ArrowRight,
  ScanLine,
  Upload,
  AlertTriangle,
} from "lucide-react";
import { api, post, refreshSession } from "./api";
import "./workflow.css";
type Actions = {
  run: (fn: () => Promise<any>) => Promise<any>;
  notify?: (s: string) => void;
};
export const scopes: Record<string, string> = {
  allergies: "Allergies",
  medications: "Current medications",
  diagnoses: "Diagnoses",
  procedures: "Procedures",
  labs: "Lab results",
  "discharge-summaries": "Discharge summaries",
  imaging: "Imaging reports",
  immunizations: "Immunization history",
  encounters: "Previous encounters",
};
const purposes: Record<string, string> = {
  "emergency-treatment": "Emergency treatment",
  treatment: "Treatment",
  "follow-up-care": "Follow-up care",
};
const statusText: Record<string, string> = {
  REQUEST_SENT: "Request sent",
  WAITING_FOR_PATIENT: "Waiting for patient approval…",
  APPROVED: "Consent approved",
  DATA_REQUESTED: "Retrieving records…",
  DATA_RECEIVED: "Records received",
  PROCESSING: "Building emergency brief…",
  READY: "Emergency brief ready",
  FAILED: "Health information service temporarily unavailable",
};
const fmt = (s: string) => new Date(s).toLocaleString("en-IN");
export function useWorkflowFeed() {
  const [requests, setRequests] = useState<any[]>([]),
    [connected, setConnected] = useState(false),
    [ended, setEnded] = useState(false);
  useEffect(() => {
    let live = true,
      source: EventSource,
      timer: ReturnType<typeof setTimeout>;
    let delay = 1000;
    const connect = () => {
      if (!live) return;
      source = new EventSource("/api/v1/workflow/events", {
        withCredentials: true,
      });
      source.addEventListener("workflow", (e) => {
        if (!live) return;
        try {
          setRequests(JSON.parse((e as MessageEvent).data).requests);
          setConnected(true);
          setEnded(false);
          delay = 1000;
        } catch {
          setConnected(false);
        }
      });
      source.addEventListener("access-ended", () => {
        source.close();
        setConnected(false);
        setEnded(true);
        setRequests([]);
      });
      source.onerror = () => {
        source.close();
        setConnected(false);
        timer = setTimeout(() => {
          refreshSession()
            .then(connect)
            .catch(() => {
              if (live) {
                setEnded(true);
                setRequests([]);
              }
            });
        }, delay);
        delay = Math.min(30000, delay * 2);
      };
    };
    api("/workflow/requests")
      .then(setRequests)
      .catch(() => {});
    connect();
    return () => {
      live = false;
      source?.close();
      clearTimeout(timer);
    };
  }, []);
  return { requests, connected, ended };
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog ref={ref} className="workflow-dialog" onCancel={onClose}>
      <div className="panel-title">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <div className="padded">{children}</div>
    </dialog>
  );
}
export function IdentityCard({ run, notify }: Actions) {
  const [identity, setIdentity] = useState<any>(null),
    [qr, setQR] = useState(""),
    [manage, setManage] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [busy, setBusy] = useState(false);
  const load = () =>
    run(async () => setIdentity(await api("/workflow/identity")));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    setQR("");
    if (identity?.qr)
      QRCode.toDataURL(identity.qr, {
        width: 320,
        margin: 3,
        errorCorrectionLevel: "M",
      }).then(setQR);
  }, [identity?.qr]);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const identifier = String(new FormData(e.currentTarget).get("identifier"));
    setBusy(true);
    await run(async () => {
      setIdentity(await post("/workflow/identity/connect", { identifier }));
      setManage(false);
      notify?.("Health identity connected to G1.");
    });
    setBusy(false);
  };
  return (
    <section className="panel identity-card">
      <div className="panel-title">
        <div>
          <h2>
            <ShieldCheck size={19} />
            Connected Health Identity
          </h2>
          <p>ABHA connected to G1 · Identity and consent initiation only</p>
        </div>
        <span className="badge amber">
          {identity?.mode === "mock"
            ? "DEMO / SYNTHETIC DATA"
            : "Live verification unavailable"}
        </span>
      </div>
      {!identity ? (
        <div
          className="workflow-skeleton"
          aria-label="Loading health identity"
        />
      ) : identity.status === "connected" ? (
        <div className="identity-grid">
          <div>
            <span className="eyebrow">AYUSHMAN BHARAT HEALTH ACCOUNT</span>
            <h3>{identity.name}</h3>
            <span className="badge green">
              {identity.verified
                ? "ABHA verified"
                : identity.verificationStatus === "MOCK_VERIFIED"
                  ? "Demo verified · not verified by NHA"
                  : "Verification required"}
            </span>
            <dl className="workflow-details">
              <dt>ABHA number</dt>
              <dd>{identity.maskedABHA}</dd>
              <dt>ABHA address</dt>
              <dd>{identity.address}</dd>
              <dt>Connected</dt>
              <dd>{fmt(identity.connectedAt)}</dd>
              <dt>Last verification</dt>
              <dd>{fmt(identity.lastVerifiedAt)}</dd>
            </dl>
            <div className="workflow-actions">
              <button
                className="secondary"
                onClick={() =>
                  run(async () =>
                    setIdentity(await post("/workflow/identity/refresh")),
                  )
                }
              >
                <RefreshCw size={15} />
                Refresh Verification
              </button>
              <button className="text-button" onClick={() => setManage(true)}>
                Manage Connection
              </button>
            </div>
          </div>
          <div className="identity-qr">
            {qr && (
              <img
                src={qr}
                alt="G1 patient identity QR. Contains no clinical records."
              />
            )}
            <button className="secondary" onClick={() => setFullscreen(true)}>
              <QrCode size={15} />
              Show QR Fullscreen
            </button>
            <small>
              G1 identity QR · valid for 10 minutes.
              <br />
              Not an official NHA/ABHA card.
            </small>
          </div>
        </div>
      ) : (
        <div className="padded">
          <p>
            Connect your health identity to initiate a consent request. Scanning
            this identity will never grant access to records.
          </p>
          <div className="workflow-actions">
            <button className="primary" onClick={() => setManage(true)}>
              Connect ABHA
            </button>
            <button className="secondary" onClick={() => setManage(true)}>
              Enter ABHA manually
            </button>
            <button className="text-button" onClick={() => setManage(true)}>
              Retry verification
            </button>
          </div>
        </div>
      )}
      {manage && (
        <Modal title="Manage health identity" onClose={() => setManage(false)}>
          <form onSubmit={submit}>
            <label className="field">
              <span>ABHA address or number</span>
              <input
                name="identifier"
                required
                maxLength={100}
                placeholder="ABHA address or 14-digit number"
              />
            </label>
            <p className="form-help">
              Mock mode accepts the synthetic account's assigned identity only.
              Demo address: aarav.sharma@abdm.
            </p>
            <button className="primary" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : null}Connect
              / Retry verification
            </button>
          </form>
          {identity.status === "connected" && (
            <button
              className="secondary danger disconnect"
              onClick={() => {
                if (
                  window.confirm(
                    "Disconnect ABHA and revoke related access requests?",
                  )
                )
                  run(async () => {
                    await api("/workflow/identity", { method: "DELETE" });
                    setManage(false);
                    await load();
                    notify?.(
                      "Identity disconnected and related access revoked.",
                    );
                  });
              }}
            >
              Disconnect ABHA
            </button>
          )}
        </Modal>
      )}
      {fullscreen && (
        <Modal
          title="G1 patient identity QR"
          onClose={() => setFullscreen(false)}
        >
          <div className="full-qr">
            <p>
              <strong>{identity.name}</strong> · {identity.maskedABHA}
            </p>
            {qr && <img src={qr} alt="Fullscreen G1 identity QR" />}
            <p>DEMO / SYNTHETIC DATA · No clinical data in this QR.</p>
            <button
              className="secondary"
              onClick={() =>
                run(async () => {
                  await load();
                })
              }
            >
              Refresh QR
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
function ConsentCard({
  request: r,
  patient,
  run,
  notify,
  onOpen,
}: { request: any; patient: boolean; onOpen?: (r: any) => void } & Actions) {
  const terminal = ["DENIED", "EXPIRED", "REVOKED", "FAILED"].includes(
    r.status,
  );
  return (
    <section className="panel workflow-consent">
      <div className="panel-title">
        <div>
          <h2>Health Information Access Request</h2>
          <p>
            {r.mode === "mock"
              ? "DEMO / SYNTHETIC DATA"
              : "ABDM health information"}
          </p>
        </div>
        <span
          className={`badge ${r.status === "APPROVED" ? "green" : terminal ? "neutral" : "amber"}`}
        >
          {r.status}
        </span>
      </div>
      <div className="padded">
        <dl className="workflow-request-details">
          <div>
            <dt>Doctor</dt>
            <dd>{r.doctorName}</dd>
          </div>
          <div>
            <dt>Hospital</dt>
            <dd>{r.hospitalName}</dd>
          </div>
          <div>
            <dt>Purpose</dt>
            <dd>{purposes[r.purpose] || r.purpose}</dd>
          </div>
          <div>
            <dt>Requested date range</dt>
            <dd>
              {r.dateFrom} — {r.dateTo}
            </dd>
          </div>
          <div>
            <dt>Access expiry</dt>
            <dd>{fmt(r.expiresAt)}</dd>
          </div>
        </dl>
        <p className="form-help">Requested information</p>
        <div className="scope-tags">
          {r.requestedScopes.map((s: string) => (
            <span className="badge" key={s}>
              {scopes[s]}
            </span>
          ))}
        </div>
        {!terminal && (
          <p className="workflow-progress" role="status">
            {!["READY", "FAILED", "WAITING_FOR_PATIENT"].includes(
              r.transferStatus,
            ) && <LoaderCircle size={16} className="spin" />}
            {statusText[r.transferStatus]}
          </p>
        )}
        {r.error && (
          <div className="message error">
            {r.error}. Previous records are not a fresh retrieval.
          </div>
        )}
        <div className="workflow-actions">
          {patient && r.status === "PENDING" && (
            <>
              <button
                className="secondary"
                onClick={() =>
                  run(async () => {
                    await post(`/workflow/requests/${r.id}/decision`, {
                      decision: "deny",
                    });
                    notify?.("Access denied.");
                  })
                }
              >
                Deny
              </button>
              <button
                className="primary"
                onClick={() =>
                  run(async () => {
                    await post(`/workflow/requests/${r.id}/decision`, {
                      decision: "approve",
                    });
                    notify?.(
                      "Access approved for the selected information and duration.",
                    );
                  })
                }
              >
                Grant Access
              </button>
            </>
          )}
          {patient && r.status === "APPROVED" && (
            <button
              className="secondary danger"
              onClick={() => {
                if (window.confirm("Revoke this clinician’s access now?"))
                  run(async () => {
                    await post(`/workflow/requests/${r.id}/decision`, {
                      decision: "revoke",
                    });
                    notify?.("Access revoked.");
                  });
              }}
            >
              Revoke active access
            </button>
          )}
          {!patient &&
            r.status === "APPROVED" &&
            r.transferStatus === "READY" && (
              <button className="primary" onClick={() => onOpen?.(r)}>
                Open G1 emergency brief
                <ArrowRight size={16} />
              </button>
            )}
          {!patient &&
            r.status === "APPROVED" &&
            r.transferStatus === "FAILED" && (
              <button
                className="secondary"
                onClick={() =>
                  run(() => post(`/workflow/requests/${r.id}/retry`))
                }
              >
                Retry retrieval
              </button>
            )}
        </div>
      </div>
    </section>
  );
}
export function WorkflowConsents({
  user,
  run,
  notify,
  onOpen,
}: Actions & { user: any; onOpen?: (r: any) => void }) {
  const { requests, connected, ended } = useWorkflowFeed();
  return (
    <div>
      <div className="workflow-section-title">
        <h2>Connected health requests</h2>
        <span className="badge">
          {connected
            ? "Live updates"
            : ended
              ? "Session ended"
              : "Reconnecting…"}
        </span>
      </div>
      {requests.map((r) => (
        <ConsentCard
          key={r.id}
          request={r}
          patient={user.role === "patient"}
          run={run}
          notify={notify}
          onOpen={onOpen}
        />
      ))}
      {!requests.length && (
        <p className="form-help">
          Health identity requests will appear here. The patient must explicitly
          grant access.
        </p>
      )}
    </div>
  );
}
export function RecentAccess({ run }: { run: Actions["run"] }) {
  const { requests } = useWorkflowFeed();
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Recent Access</h2>
        <span className="badge">Live consent status</span>
      </div>
      {requests.length ? (
        requests
          .slice(-3)
          .reverse()
          .map((r) => (
            <div className="list-row" key={r.id}>
              <ShieldCheck size={18} />
              <div className="grow">
                <strong>
                  {r.doctorName} · {r.hospitalName}
                </strong>
                <small>
                  {purposes[r.purpose]} · {fmt(r.createdAt)}
                </small>
              </div>
              <span className="badge">{r.status}</span>
            </div>
          ))
      ) : (
        <p className="padded form-help">No connected health access yet.</p>
      )}
    </section>
  );
}
export function ScanPatient({
  run,
  notify,
  onOpen,
}: Actions & { onOpen: (r: any) => void }) {
  const [identity, setIdentity] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [camera, setCamera] = useState(false),
    [cameraError, setCameraError] = useState(""),
    [range, setRange] = useState("1y"),
    [from, setFrom] = useState(
      new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10)),
    [duration, setDuration] = useState("60"),
    [requestId, setRequestId] = useState("");
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    scanning = useRef(false);
  const { requests, connected } = useWorkflowFeed();
  const request = requests.find((r) => r.id === requestId);
  const resolveIdentity = async (input: any) => {
    setBusy(true);
    await run(async () => {
      setIdentity(await post("/workflow/resolve", input));
      setRequestId("");
      setCamera(false);
      stream.current?.getTracks().forEach((t) => t.stop());
    });
    setBusy(false);
  };
  useEffect(() => {
    if (!camera) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval>;
    const start = async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play();
        }
        timer = setInterval(() => {
          if (
            !video.current ||
            video.current.readyState < 2 ||
            scanning.current
          )
            return;
          const canvas = document.createElement("canvas");
          canvas.width = Math.min(video.current.videoWidth, 960);
          canvas.height = Math.round(
            (video.current.videoHeight * canvas.width) /
              video.current.videoWidth,
          );
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return;
          context.drawImage(video.current, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const code = jsQR(pixels.data, canvas.width, canvas.height);
          if (code) {
            scanning.current = true;
            resolveIdentity({ qr: code.data }).finally(() => {
              scanning.current = false;
            });
          }
        }, 300);
      } catch {
        setCameraError(
          "Camera unavailable or permission denied. Upload a QR image or enter ABHA manually.",
        );
        setCamera(false);
      }
    };
    start();
    return () => {
      cancelled = true;
      clearInterval(timer);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [camera]);
  const readImage = async (file?: File) => {
    if (!file) return;
    await run(async () => {
      if (
        file.size > 5 * 1024 * 1024 ||
        !["image/png", "image/jpeg"].includes(file.type)
      )
        throw new Error("Choose a PNG or JPEG QR image under 5 MB");
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 16000000)
          throw new Error("QR image is too large");
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height),
          code = jsQR(pixels.data, canvas.width, canvas.height);
        if (!code)
          throw new Error(
            "No readable QR found. Use a clear G1 identity QR or the manual fallback.",
          );
        await resolveIdentity({ qr: code.data });
      } finally {
        bitmap.close();
      }
    });
  };
  const selectRange = (value: string) => {
    setRange(value);
    if (value !== "custom") {
      setTo(new Date().toISOString().slice(0, 10));
      setFrom(
        value === "all"
          ? "1900-01-01"
          : new Date(
              Date.now() -
                ({ "30d": 30, "6m": 183, "1y": 365, "5y": 1826 }[value] ||
                  365) *
                  86400000,
            )
              .toISOString()
              .slice(0, 10),
      );
    }
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const expiry =
      duration === "custom"
        ? new Date(String(form.get("customExpiry"))).toISOString()
        : new Date(Date.now() + Number(duration) * 60000).toISOString();
    setBusy(true);
    await run(async () => {
      const result = await post("/workflow/requests", {
        accessSessionId: identity.accessSessionId,
        purpose: form.get("purpose"),
        requestedScopes: form.getAll("scope"),
        dateFrom: from,
        dateTo: to,
        expiresAt: expiry,
      });
      setRequestId(result.id);
      notify?.("Request sent. Waiting for explicit patient approval.");
    });
    setBusy(false);
  }
  return (
    <>
      <div className="heading">
        <div>
          <span className="eyebrow">IDENTITY → CONSENT → EVIDENCE</span>
          <h1>Scan patient</h1>
          <p>
            Resolve identity first. Medical information stays protected until
            the patient approves.
          </p>
        </div>
        <span className="badge">
          {connected ? "Live updates" : "Connecting…"}
        </span>
      </div>
      <section className="panel padded">
        <h2>Scan Patient ABHA QR</h2>
        <p className="form-help">
          G1 identity QR supported. Official ABHA QR formats require a validated
          sandbox decoder; use the manual fallback.
        </p>
        <div className="workflow-actions">
          <button
            className="primary"
            onClick={() => {
              setCameraError("");
              setCamera(!camera);
            }}
          >
            <Camera size={17} />
            {camera ? "Stop camera" : "Start camera scan"}
          </button>
          <label className="secondary upload-qr">
            <Upload size={17} />
            Upload QR image
            <input
              type="file"
              aria-label="Upload QR image"
              accept="image/png,image/jpeg"
              onChange={(e) => readImage(e.target.files?.[0])}
            />
          </label>
        </div>
        {camera && <video ref={video} className="qr-video" playsInline muted />}
        {cameraError && (
          <div className="message error" role="alert">
            {cameraError}
          </div>
        )}
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            resolveIdentity({
              identifier: new FormData(e.currentTarget).get("identifier"),
            });
          }}
        >
          <label className="field">
            <span>Manual ABHA address / number</span>
            <input
              name="identifier"
              required
              maxLength={100}
              placeholder="ABHA address or 14-digit number"
            />
          </label>
          <button className="secondary" disabled={busy}>
            Resolve patient
          </button>
        </form>
        <details>
          <summary>Paste a G1 QR payload</summary>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              resolveIdentity({ qr: new FormData(e.currentTarget).get("qr") });
            }}
          >
            <label className="field">
              <span>QR payload</span>
              <input name="qr" required maxLength={1024} />
            </label>
            <button className="secondary" disabled={busy}>
              Validate QR
            </button>
          </form>
        </details>
      </section>
      {busy && (
        <div className="workflow-skeleton" aria-label="Resolving patient" />
      )}
      {identity && (
        <section className="panel padded">
          <h2>{identity.name}</h2>
          <div className="workflow-actions">
            <span className="badge">{identity.maskedABHA}</span>
            <span className="badge green">
              {identity.verificationStatus === "MOCK_VERIFIED"
                ? "Demo verified · not NHA verified"
                : "ABHA verified"}
            </span>
            <span className="badge">Identity resolved</span>
          </div>
          <p className="form-help">
            No clinical history is disclosed in this identity preview.
          </p>
          {!requestId && (
            <form onSubmit={submit}>
              <h3>Request Health Information</h3>
              <div className="form-grid">
                <label className="field">
                  <span>Purpose</span>
                  <select name="purpose">
                    {Object.entries(purposes).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Time range</span>
                  <select
                    aria-label="Time range"
                    value={range}
                    onChange={(e) => selectRange(e.target.value)}
                  >
                    {[
                      ["30d", "Last 30 days"],
                      ["6m", "6 months"],
                      ["1y", "1 year"],
                      ["5y", "5 years"],
                      ["custom", "Custom range"],
                      ["all", "Complete available history"],
                    ].map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>From date</span>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setRange("custom");
                    }}
                    required
                  />
                </label>
                <label className="field">
                  <span>To date</span>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setRange("custom");
                    }}
                    required
                  />
                </label>
                <label className="field">
                  <span>Access duration</span>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  >
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="120">2 hours</option>
                    <option value="custom">Custom expiry</option>
                  </select>
                </label>
                {duration === "custom" && (
                  <label className="field">
                    <span>Custom access expiry (within 24 hours)</span>
                    <input type="datetime-local" name="customExpiry" required />
                  </label>
                )}
              </div>
              <fieldset>
                <legend>Requested information · select explicitly</legend>
                <div className="checkboxes">
                  {Object.entries(scopes).map(([id, label]) => (
                    <label key={id}>
                      <input type="checkbox" name="scope" value={id} />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button className="primary" disabled={busy}>
                Request Health Information
                <ArrowRight size={16} />
              </button>
            </form>
          )}
        </section>
      )}
      {request && (
        <ConsentCard
          request={request}
          patient={false}
          run={run}
          notify={notify}
          onOpen={onOpen}
        />
      )}
    </>
  );
}
