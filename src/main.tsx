import React, { useEffect, useState, useRef, FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  QrCode,
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  FileText,
  Flag,
  HeartPulse,
  History,
  KeyRound,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Stethoscope,
  Upload,
  UserRound,
  Users,
  X,
  AlertTriangle,
} from "lucide-react";
import { api, post, setContext, downloadSource, refreshSession } from "./api";
import "./styles.css";
type User = {
  id: string;
  role: "patient" | "doctor" | "hospital";
  name: string;
  email: string;
  patientId?: string;
  tenant: string;
  verified: boolean;
  mfaEnabled: boolean;
};
const types = [
  "discharge",
  "prescription",
  "diagnostic",
  "laboratory",
  "hospital",
];
const factTitles: Record<string, string> = {
  allergy: "Allergies",
  medication: "Medications",
  condition: "Conditions",
  procedure: "Procedures",
  implant: "Implants",
  hospitalization: "Hospitalizations",
  immunization: "Immunizations",
  demographic: "Source demographics",
  observation: "Observations",
};
const nice = (s: string) =>
  s.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
const date = (s: string) =>
  s
    ? new Date(s).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Not available";
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  title,
  children,
  icon: Icon = FileText,
}: {
  title: string;
  children: React.ReactNode;
  icon?: any;
}) {
  return (
    <div className="empty">
      <Icon size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
import {
  IdentityCard,
  ScanPatient,
  WorkflowConsents,
  RecentAccess,
  useWorkflowFeed,
} from "./workflow";
function App() {
  const [initialRequest, setInitialRequest] = useState<any>(null);
  const openWorkflow = (request: any) => {
    setInitialRequest(request);
    setView("brief");
  };
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [view, setView] = useState("home"),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [mobile, setMobile] = useState(false);
  const notify = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(""), 5000);
  };
  useEffect(() => {
    api("/auth/me")
      .catch(() => refreshSession())
      .then((d) => setUser(d.user))
      .catch(() => {})
      .finally(() => setLoading(false));
    const expired = () => {
      setUser(null);
      setError("Your session expired. Sign in again.");
    };
    window.addEventListener("g1:session-expired", expired);
    return () => window.removeEventListener("g1:session-expired", expired);
  }, []);
  const run = async (fn: () => Promise<any>) => {
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    }
  };
  const logout = () =>
    run(async () => {
      await post("/auth/logout");
      setUser(null);
      setContext({});
      setView("home");
    });
  if (loading)
    return (
      <div className="boot">
        <Activity />
        Opening G1…
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          setView(u.role === "doctor" ? "brief" : "home");
          setError("");
        }}
        error={error}
        run={run}
      />
    );
  const nav =
    user.role === "patient"
      ? [
          ["home", "Overview", LayoutDashboard],
          ["records", "Medical records", FileText],
          ["brief", "My G1 brief", HeartPulse],
          ["consents", "Consent & access", ShieldCheck],
          ["audit", "Access history", History],
          ["privacy", "Profile & privacy", Settings2],
        ]
      : user.role === "doctor"
        ? [
            ["brief", "Patient brief", HeartPulse],
            ["scan", "Scan patient", QrCode],
            ["consents", "Access requests", ShieldCheck],
            ["audit", "Access history", History],
            ["privacy", "Account security", KeyRound],
          ]
        : [
            ["home", "Overview", LayoutDashboard],
            ["doctors", "Clinicians", Stethoscope],
            ["departments", "Departments", Building2],
            ["integrations", "Integrations", Link2],
            ["policies", "Policies", Settings2],
            ["audit", "Audit & security", ShieldCheck],
            ["privacy", "Account security", KeyRound],
          ];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span>G1</span>
          <div>
            G1 Health<small>HISTORY. WITH EVIDENCE.</small>
          </div>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            {user.role === "doctor" ? (
              <Stethoscope size={20} />
            ) : user.role === "hospital" ? (
              <Building2 size={20} />
            ) : (
              <UserRound size={20} />
            )}
          </span>
          <div>
            {nice(user.role)} workspace<small>Secure clinical history</small>
          </div>
          <LockKeyhole size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id as string}
              className={view === id ? "selected" : ""}
              onClick={() => {
                setView(id as string);
                setMobile(false);
                setError("");
              }}
            >
              {React.createElement(Icon as any, { size: 19 })}
              {label as string}
              {view === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="trust-card">
            <ShieldCheck size={22} />
            <strong>Your history. Your control.</strong>
            <p>Access is scoped, time-bound, and recorded.</p>
          </div>
          <div className="account">
            <span className="avatar">
              {user.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{nice(user.role)} account</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />{" "}
            <strong>{nav.find((n) => n[0] === view)?.[1] as string}</strong>
          </div>
          <div className="top-actions">
            <span className="secure">
              <span className="green-dot" />
              Encrypted workspace
            </span>
            <button
              className="icon-button"
              aria-label="View access activity"
              onClick={() => setView("audit")}
            >
              <Bell size={19} />
            </button>
          </div>
        </header>
        <main>
          <div className="dev-banner">
            <ShieldCheck size={15} /> Development build · Use synthetic records
            only · Clinical validation pending
          </div>
          {error && (
            <div className="message error" role="alert">
              <AlertTriangle size={18} />
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={17} />
              </button>
            </div>
          )}
          {success && (
            <div className="message success" role="status">
              <CheckCircle2 size={18} />
              {success}
            </div>
          )}
          {user.role === "patient" && view === "home" && (
            <Overview user={user} navigate={setView} run={run} />
          )}
          {view === "records" && <Records run={run} notify={notify} />}
          {view === "brief" && (
            <>
              {user.role === "doctor" && (
                <button
                  className="primary scan-cta"
                  onClick={() => setView("scan")}
                >
                  <QrCode size={17} />
                  Scan Patient ABHA QR
                </button>
              )}
              <Brief
                user={user}
                run={run}
                notify={notify}
                initialRequest={initialRequest}
              />
            </>
          )}
          {view === "scan" && user.role === "doctor" && (
            <ScanPatient run={run} notify={notify} onOpen={openWorkflow} />
          )}
          {view === "consents" && (
            <Consents user={user} run={run} notify={notify} />
          )}
          {view === "audit" && <Audit run={run} />}
          {view === "privacy" && (
            <Privacy user={user} run={run} notify={notify} />
          )}
          {user.role === "hospital" &&
            [
              "home",
              "doctors",
              "departments",
              "integrations",
              "policies",
            ].includes(view) && (
              <Hospital
                view={view}
                run={run}
                notify={notify}
                navigate={setView}
              />
            )}
          <footer>
            <span className="footer-brand">G1</span> Evidence-linked medical
            history{" "}
            <span>Privacy by design · No diagnosis or treatment advice</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
type Actions = {
  run: (fn: () => Promise<any>) => Promise<any>;
  notify: (s: string) => void;
};
function Login({
  onLogin,
  error,
  run,
}: {
  onLogin: (u: User) => void;
  error: string;
  run: Actions["run"];
}) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    if (!body.code) delete body.code;
    setBusy(true);
    await run(async () => {
      const d = await post(register ? "/auth/register" : "/auth/login", body);
      onLogin(d.user);
    });
    setBusy(false);
  }
  return (
    <div className="login">
      <section className="login-story">
        <div className="brand light">
          <span>G1</span>
          <div>
            G1 Health<small>HISTORY. WITH EVIDENCE.</small>
          </div>
        </div>
        <div>
          <Badge tone="light">MEDICAL HISTORY INTELLIGENCE</Badge>
          <h1>
            The right history.
            <br />
            When every
            <br />
            <em>second matters.</em>
          </h1>
          <p>
            A clear, evidence-linked view of existing medical records. Built
            around patient consent and clinical context.
          </p>
          <div className="story-features">
            <span>
              <Link2 />
              Trace every fact to its source
            </span>
            <span>
              <ShieldCheck />
              Control who can see your records
            </span>
            <span>
              <Clock />
              Make sense of history, faster
            </span>
          </div>
        </div>
        <small>
          G1 reconstructs history. It does not diagnose or prescribe.
        </small>
      </section>
      <section className="login-form">
        <div className="login-inner">
          <span className="eyebrow">YOUR SECURE WORKSPACE</span>
          <h2>
            {register ? "Your health history, together." : "Welcome back."}
          </h2>
          <p>
            {register
              ? "Create a patient account to upload records and manage consent."
              : "Sign in to access your medical history workspace."}
          </p>
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={submit}>
            {register && (
              <Field label="Full name">
                <input
                  name="name"
                  required
                  minLength={2}
                  autoComplete="name"
                  placeholder="Your full name"
                />
              </Field>
            )}
            <Field label="Email address">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password">
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={12}
                placeholder="At least 12 characters"
              />
            </Field>
            {!register && (
              <Field label="Authenticator code (if enabled)">
                <input
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                />
              </Field>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : null}
              {register ? "Create patient account" : "Sign in securely"}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="login-switch">
            {register ? "Already have an account?" : "New to G1?"}{" "}
            <button onClick={() => setRegister(!register)}>
              {register ? "Sign in" : "Create a patient account"}
            </button>
          </p>
          <div className="login-note">
            <LockKeyhole size={18} />
            <span>
              Clinician and hospital accounts are provisioned by authorized
              administrators.
            </span>
          </div>
          <div className="demo-note">
            Local development build. Use synthetic information only.
            <br />
            Run <code>npm run seed</code> for demonstration accounts.
          </div>
        </div>
      </section>
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
function Overview({
  user,
  navigate,
  run,
}: {
  user: User;
  navigate: (v: string) => void;
  run: Actions["run"];
}) {
  const [records, setRecords] = useState<any[]>([]),
    [consents, setConsents] = useState<any[]>([]),
    [events, setEvents] = useState<any[]>([]);
  useEffect(() => {
    run(async () => {
      const [r, c, e] = await Promise.all([
        api("/records"),
        api("/consents"),
        api("/audit/me"),
      ]);
      setRecords(r);
      setConsents(c);
      setEvents(e);
    });
  }, []);
  return (
    <>
      <Heading
        eyebrow="YOUR HEALTH, IN CONTEXT"
        title={`Hello, ${user.name.split(" ")[0]}.`}
        description="Your records, your permissions, and a clearer picture of your history."
      >
        <button className="primary" onClick={() => navigate("records")}>
          <Plus size={18} />
          Upload a record
        </button>
      </Heading>
      <IdentityCard run={run} />
      <section className="hero-card">
        <div>
          <Badge tone="light">
            <Activity size={13} />
            YOUR G1 BRIEF
          </Badge>
          <h2>
            Your medical history.
            <br />
            One connected view.
          </h2>
          <p>
            Important facts, a clear timeline, and the original
            <br className="desktop" /> evidence. Ready when you need them.
          </p>
          <button className="white-button" onClick={() => navigate("brief")}>
            Open my G1 brief
            <ArrowUpRight size={17} />
          </button>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="visual-core">
            <Activity size={56} />
          </div>
          <div className="float-tag tag-one">
            <FileText size={18} />
            <div>
              Source records<small>Connected with evidence</small>
            </div>
            <CheckCircle2 size={17} />
          </div>
          <div className="float-tag tag-two">
            <ShieldCheck size={18} />
            <div>
              Patient controlled<small>Consent at every step</small>
            </div>
          </div>
        </div>
      </section>
      <div className="stats">
        <Stat
          label="Medical records"
          value={records.length}
          detail={`${records.filter((r) => r.status === "completed").length} processed records`}
          icon={FileText}
        />
        <Stat
          label="Active access"
          value={consents.filter((c) => c.status === "granted").length}
          detail="Time-bound clinician permissions"
          icon={ShieldCheck}
        />
        <Stat
          label="Pending requests"
          value={consents.filter((c) => c.status === "requested").length}
          detail="Waiting for your decision"
          icon={Clock}
        />
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Recent records</h2>
              <p>Your latest additions to G1</p>
            </div>
            <button className="text-button" onClick={() => navigate("records")}>
              View all
              <ArrowRight size={15} />
            </button>
          </div>
          {records.length ? (
            records
              .slice(-4)
              .reverse()
              .map((r) => (
                <div className="list-row" key={r.id}>
                  <div className="file-icon">
                    <FileText size={21} />
                  </div>
                  <div className="grow">
                    <strong>{r.name}</strong>
                    <small>
                      {nice(r.recordType)} · {date(r.recordDate)}
                    </small>
                  </div>
                  <Badge
                    tone={
                      r.status === "completed"
                        ? "green"
                        : r.status === "failed"
                          ? "red"
                          : "amber"
                    }
                  >
                    {nice(r.status)}
                  </Badge>
                </div>
              ))
          ) : (
            <Empty title="Your history starts here">
              Upload your first record to create an evidence-linked brief.
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>You're in control</h2>
              <p>Review who can access your history</p>
            </div>
            <ShieldCheck className="teal" size={23} />
          </div>
          <div className="consent-overview">
            <span className="large-icon">
              <ShieldCheck size={30} />
            </span>
            <h3>
              {consents.some((c) => c.status === "requested")
                ? "A clinician is requesting access"
                : "Your records stay private"}
            </h3>
            <p>
              Clinicians need your explicit consent, with a purpose, record
              scope, and expiry.
            </p>
            <button
              className="secondary wide"
              onClick={() => navigate("consents")}
            >
              Manage consent & access
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="mini-note">
            <LockKeyhole size={15} />
            Hospital administrators cannot read your clinical history.
          </div>
        </section>
      </div>
      <RecentAccess run={run} />
      <section className="panel activity-panel">
        <div className="panel-title">
          <div>
            <h2>Recent activity</h2>
            <p>A transparent record of actions in your workspace</p>
          </div>
          <button className="text-button" onClick={() => navigate("audit")}>
            Access history
            <ArrowRight size={15} />
          </button>
        </div>
        {events.slice(0, 3).map((e) => (
          <div className="activity-row" key={e.id}>
            <span className="activity-dot" />
            <strong>{nice(e.action.replaceAll(".", " "))}</strong>
            <span>{date(e.timestamp)}</span>
            <Badge>Logged</Badge>
          </div>
        ))}
        {!events.length && (
          <p className="muted padded">Your activity will appear here.</p>
        )}
      </section>
    </>
  );
}
function Stat({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: any;
}) {
  return (
    <div className="stat">
      <div>
        <span>{label}</span>
        <strong>{String(value).padStart(2, "0")}</strong>
        <small>{detail}</small>
      </div>
      <span className="stat-icon">
        <Icon size={23} />
      </span>
    </div>
  );
}
function Records({ run, notify }: Actions) {
  const [records, setRecords] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState("");
  const load = () => run(async () => setRecords(await api("/records")));
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    await run(async () => {
      await api("/documents", { method: "POST", body: new FormData(form) });
      form.reset();
      notify("Record uploaded. Processing will update automatically.");
      await load();
    });
    setBusy(false);
  }
  return (
    <>
      <Heading
        eyebrow="BUILD YOUR HISTORY"
        title="Medical records"
        description="Upload original records. G1 keeps every extracted fact connected to its source."
      />
      <section className="panel upload-panel">
        <div className="upload-intro">
          <span className="large-icon">
            <Upload size={26} />
          </span>
          <h2>Add a medical record</h2>
          <p>
            PDF, PNG, JPEG, FHIR JSON, or text · Up to 10 MB
            <br />
            Images require a configured private OCR service.
          </p>
        </div>
        <form onSubmit={upload} className="upload-form">
          <Field label="Select a file">
            <input
              type="file"
              name="file"
              accept=".pdf,.png,.jpg,.jpeg,.json,.txt"
              required
            />
          </Field>
          <div className="form-grid">
            <Field label="Record type">
              <select name="recordType">
                {types.map((t) => (
                  <option key={t} value={t}>
                    {nice(t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Record date">
              <input
                type="date"
                name="recordDate"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </Field>
          </div>
          <button className="primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Upload size={16} />
            )}
            Upload & process
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>
              All records <span className="count">{records.length}</span>
            </h2>
            <p>Originals are encrypted and integrity checked</p>
          </div>
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Search records"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search records…"
            />
          </label>
        </div>
        {records
          .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
          .map((r) => (
            <div className="record-row" key={r.id}>
              <span className="file-icon">
                <FileText size={23} />
              </span>
              <div className="grow">
                <strong>{r.name}</strong>
                <small>
                  {nice(r.recordType)} · {date(r.recordDate)} ·{" "}
                  {r.factCount || 0} extracted facts
                </small>
                {r.error && <p className="inline-error">{r.error}</p>}
              </div>
              <Badge
                tone={
                  r.status === "completed"
                    ? "green"
                    : r.status === "failed"
                      ? "red"
                      : "amber"
                }
              >
                {nice(r.status)}
              </Badge>
              <div className="row-actions">
                {r.status === "completed" && (
                  <button
                    className="icon-button"
                    title="Download source"
                    aria-label={`Download ${r.name}`}
                    onClick={() => run(() => downloadSource(r.id))}
                  >
                    <Download size={18} />
                  </button>
                )}
                {r.status === "failed" && (
                  <button
                    className="text-button"
                    onClick={() =>
                      run(async () => {
                        await post(`/documents/${r.id}/retry`);
                        await load();
                      })
                    }
                  >
                    Retry
                  </button>
                )}
                <button
                  className="text-button danger"
                  disabled={r.status === "processing"}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${r.name} and its extracted facts? This cannot be undone.`,
                      )
                    )
                      run(async () => {
                        await api(`/documents/${r.id}`, { method: "DELETE" });
                        await load();
                        notify("Record and extracted facts deleted.");
                      });
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        {!records.length && (
          <Empty title="No records yet">
            Try the synthetic sample in the project's fixtures folder, or upload
            your own test record.
          </Empty>
        )}
      </section>
    </>
  );
}
function Brief({
  user,
  run,
  notify,
  initialRequest,
}: Actions & { user: User; initialRequest?: any }) {
  const workflowFeed = useWorkflowFeed();
  const requestVersion = useRef(0);
  const [patients, setPatients] = useState<any[]>([]),
    [selected, setSelected] = useState(user.patientId || ""),
    [consent, setConsent] = useState(""),
    [brief, setBrief] = useState<any>(null),
    [mode, setMode] = useState("30-second"),
    [tab, setTab] = useState("overview"),
    [evidence, setEvidence] = useState<any>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user.role === "doctor")
      run(async () => {
        const p = await api("/patients");
        setPatients(p);
        if (p.length) {
          const target =
            p.find((x: any) => x.patientId === initialRequest?.patientId) ||
            p[0];
          setSelected(target.patientId);
          setConsent(
            target.consents.find((c: any) => c.id === initialRequest?.id)?.id ||
              target.consents[0].id,
          );
        }
      });
    else setContext({});
  }, []);
  const load = async () => {
    const version = ++requestVersion.current;
    setBrief(null);
    setEvidence(null);
    setBusy(false);
    if (!selected) return;
    const c = patients
      .find((p) => p.patientId === selected)
      ?.consents.find((c: any) => c.id === consent);
    if (user.role === "doctor" && !c) return;
    setContext(c ? { consentId: c.id, purpose: c.purpose } : {});
    setBusy(true);
    await run(async () => {
      const result = await api(`/patients/${selected}/brief`);
      if (requestVersion.current === version) setBrief(result);
    });
    if (requestVersion.current === version) setBusy(false);
  };
  useEffect(() => {
    load();
    return () => {
      requestVersion.current++;
    };
  }, [selected, consent]);
  useEffect(() => {
    if (user.role !== "doctor") return;
    const timer = setInterval(() => {
      const version = requestVersion.current;
      api(`/patients/${selected}/brief`)
        .then((result) => {
          if (version === requestVersion.current) setBrief(result);
        })
        .catch(() => {
          if (version !== requestVersion.current) return;
          setBrief(null);
          setEvidence(null);
        });
    }, 15000);
    return () => clearInterval(timer);
  }, [selected, consent]);
  useEffect(() => {
    const request = workflowFeed.requests.find((r: any) => r.id === consent);
    if (workflowFeed.ended || (request && request.status !== "APPROVED")) {
      requestVersion.current++;
      setBrief(null);
      setEvidence(null);
    }
  }, [workflowFeed.requests, workflowFeed.ended, consent]);
  const openEvidence = (f: any) =>
    run(async () => {
      const version = requestVersion.current;
      const data = await api(`/facts/${f.id}/evidence`);
      if (version === requestVersion.current) setEvidence({ ...data, fact: f });
    });
  const annotate = (f: any, type: string) => {
    const note = window.prompt(
      type === "flag"
        ? "Describe the issue in this source-linked fact:"
        : "Add a clinical annotation (does not alter the source):",
    );
    if (note)
      run(async () => {
        await post(`/doctors/${user.id}/annotations`, {
          patientId: selected,
          factId: f.id,
          note,
          type,
        });
        notify(
          type === "flag" ? "Issue flagged for review." : "Annotation saved.",
        );
      });
  };
  const visible = brief
    ? tab === "timeline"
      ? brief.timeline
      : tab === "allergy" || tab === "medication"
        ? brief.facts.filter((f: any) => f.type === tab)
        : mode === "10-second"
          ? brief.critical
          : brief.facts
    : [];
  return (
    <>
      <Heading
        eyebrow="EVIDENCE-LINKED HISTORY"
        title={user.role === "doctor" ? "Patient brief" : "My G1 brief"}
        description="A structured view of existing records, with uncertainty kept visible."
      >
        <button className="secondary" onClick={load}>
          <Activity size={16} />
          Refresh history
        </button>
      </Heading>
      {user.role === "doctor" && (
        <div className="panel patient-picker">
          <Field label="Authorized patient">
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setConsent(
                  patients.find((p) => p.patientId === e.target.value)
                    ?.consents[0].id || "",
                );
              }}
            >
              <option value="">Select a patient</option>
              {patients.map((p) => (
                <option key={p.patientId} value={p.patientId}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Purpose & consent">
            <select
              value={consent}
              onChange={(e) => setConsent(e.target.value)}
            >
              {patients
                .find((p) => p.patientId === selected)
                ?.consents.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {nice(c.purpose)} · expires {date(c.validUntil)}
                  </option>
                ))}
            </select>
          </Field>
          <Badge tone="green">
            <ShieldCheck size={13} />
            Consent checked on every read
          </Badge>
        </div>
      )}
      {busy && (
        <div className="loading">
          <LoaderCircle className="spin" />
          Loading authorized history…
        </div>
      )}
      {!brief && !busy && (
        <section className="panel">
          <Empty
            title={
              user.role === "doctor"
                ? "Select an authorized patient"
                : "No brief available"
            }
            icon={ShieldCheck}
          >
            {user.role === "doctor"
              ? "Request access using the patient’s reference, then wait for them to grant consent."
              : "Upload a supported record to begin. Any access or connection error appears above."}
          </Empty>
        </section>
      )}
      {brief && (
        <>
          <section className="brief-summary">
            <Badge>
              {brief.patient?.abhaStatus === "VERIFIED"
                ? "ABHA verified"
                : brief.patient?.abhaStatus === "MOCK_VERIFIED"
                  ? "Demo identity · not NHA verified"
                  : "ABHA not verified"}
            </Badge>
            <div>
              <span className="large-icon">
                <HeartPulse size={27} />
              </span>
              <div>
                <h2>
                  {user.role === "patient"
                    ? user.name
                    : patients.find((p) => p.patientId === selected)?.name}
                </h2>
                <p>
                  {brief.patient?.age !== null
                    ? `${brief.patient?.age} years · `
                    : ""}
                  {nice(brief.patient?.sex || "not provided")} ·{" "}
                  {brief.coverage.documents} source records · Updated{" "}
                  {date(brief.coverage.latest)}
                </p>
              </div>
            </div>
            <div className="summary-meta">
              <Badge tone="green">
                <Link2 size={12} />
                Every fact has evidence
              </Badge>
              <span>{brief.coverage.facts} distinct facts</span>
            </div>
          </section>
          <div className="brief-warning">
            <AlertTriangle size={17} />
            <div>
              <strong>
                {brief.conflicts.length
                  ? `${brief.conflicts.length} source disagreement${brief.conflicts.length > 1 ? "s" : ""} need review`
                  : "Partial history · Verify original records"}
              </strong>
              <p>{brief.notice}</p>
            </div>
            {brief.conflicts.length > 0 && (
              <button
                className="text-button"
                onClick={() => setTab("conflicts")}
              >
                Review conflicts
                <ArrowRight size={15} />
              </button>
            )}
          </div>
          <div className="brief-controls">
            <div className="tabs">
              {[
                ["overview", "Overview"],
                ["timeline", "Timeline"],
                ["medication", "Medications"],
                ["allergy", "Allergies"],
                ["conflicts", `Conflicts (${brief.conflicts.length})`],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={tab === id ? "active" : ""}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="segmented">
              {["10-second", "30-second", "detailed"].map((m) => (
                <button
                  key={m}
                  className={mode === m ? "active" : ""}
                  onClick={() => setMode(m)}
                >
                  {nice(m)}
                </button>
              ))}
            </div>
          </div>
          <div className={`brief-layout ${evidence ? "with-evidence" : ""}`}>
            <section>
              {tab === "conflicts" ? (
                <div className="panel">
                  {brief.conflicts.map((c: any) => (
                    <div className="conflict-item" key={c.id}>
                      <Badge tone="amber">Unresolved</Badge>
                      <h3>{c.description}</h3>
                      {c.factRefs.map((id: string) => {
                        const f = brief.facts.find((f: any) => f.id === id);
                        return (
                          f && (
                            <FactRow
                              key={id}
                              f={f}
                              open={openEvidence}
                              mode="detailed"
                            />
                          )
                        );
                      })}
                    </div>
                  ))}
                  {!brief.conflicts.length && (
                    <Empty title="No conflicts detected" icon={CheckCircle2}>
                      This does not establish that the history is complete or
                      clinically validated.
                    </Empty>
                  )}
                </div>
              ) : !visible.length ? (
                <section className="panel">
                  <Empty title="No source-linked facts in this view">
                    The uploaded record may need manual review or a supported
                    structured format.
                  </Empty>
                </section>
              ) : tab === "timeline" ? (
                <section className="panel timeline">
                  {visible.map((f: any) => (
                    <div key={f.id} className="timeline-entry">
                      <div className="timeline-date">
                        {date(f.effectiveDate)}
                      </div>
                      <FactRow
                        f={f}
                        open={openEvidence}
                        mode={mode}
                        annotate={user.role === "doctor" ? annotate : undefined}
                      />
                    </div>
                  ))}
                </section>
              ) : (
                Object.entries(factTitles).map(([type, title]) => {
                  const facts = visible.filter((f: any) => f.type === type);
                  return (
                    !!facts.length && (
                      <section className="panel fact-section" key={type}>
                        <div className="fact-section-title">
                          <h2>{title}</h2>
                          <Badge>
                            {facts.length} fact{facts.length > 1 ? "s" : ""}
                          </Badge>
                        </div>
                        {facts.map((f: any) => (
                          <FactRow
                            key={f.id}
                            f={f}
                            open={openEvidence}
                            mode={mode}
                            annotate={
                              user.role === "doctor" ? annotate : undefined
                            }
                          />
                        ))}
                      </section>
                    )
                  );
                })
              )}
            </section>
            {evidence && (
              <aside className="evidence-panel panel">
                <div className="panel-title">
                  <h2>
                    <Link2 size={18} />
                    Source evidence
                  </h2>
                  <button
                    className="icon-button"
                    aria-label="Close evidence"
                    onClick={() => setEvidence(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="evidence-content">
                  <Badge tone="green">Source-linked</Badge>
                  <h3>{evidence.fact.value}</h3>
                  <p>
                    Extractor confidence:{" "}
                    {Math.round(evidence.fact.confidence * 100)}% ·{" "}
                    {nice(evidence.fact.status)}
                  </p>
                  {evidence.evidence.map((e: any, i: number) => (
                    <div className="source-card" key={i}>
                      <span className="eyebrow">ORIGINAL SOURCE EXCERPT</span>
                      <blockquote>{e.span}</blockquote>
                      <dl>
                        <dt>Source document</dt>
                        <dd>{e.sourceDocument || "Source record"}</dd>
                        <dt>Source date</dt>
                        <dd>{e.sourceDate || "Not stated"}</dd>
                        <dt>Location</dt>
                        <dd>
                          {e.page ? `Page ${e.page}` : e.path || e.section}
                        </dd>
                        <dt>Section</dt>
                        <dd>{e.section || "Structured record"}</dd>
                        <dt>Source SHA-256</dt>
                        <dd className="hash">{e.sourceHash}</dd>
                      </dl>
                      <button
                        className="secondary wide"
                        onClick={() => run(() => downloadSource(e.documentId))}
                      >
                        <Download size={15} />
                        Download original
                      </button>
                    </div>
                  ))}
                </div>
              </aside>
            )}
          </div>
          {brief.summaryStatus === "fallback" && (
            <div className="message error">
              Summary provider unavailable. Showing source-linked history;
              original authorized records remain available.
            </div>
          )}
          {mode === "detailed" && (
            <section className="panel original-records">
              <h2>Original Records</h2>
              {brief.records?.map((record: any) => (
                <div className="list-row" key={record.id}>
                  <div className="grow">
                    <strong>{record.name}</strong>
                    <small>{date(record.recordDate)}</small>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => run(() => downloadSource(record.id))}
                  >
                    View original record
                  </button>
                </div>
              ))}
              <h2>Clinical notes</h2>
              {brief.annotations?.length ? (
                brief.annotations.map((note: any) => (
                  <div className="workflow-note" key={note.id}>
                    <p>{note.note}</p>
                    <small>
                      Clinician annotation · {date(note.createdAt)} · original
                      source unchanged
                    </small>
                  </div>
                ))
              ) : (
                <p className="form-help">
                  Use the plus button beside a fact to add a clinical note.
                </p>
              )}
            </section>
          )}
          <div className="method-note">
            <ShieldCheck size={16} />
            Structured extraction · {brief.versions.extractor} · No external AI
            model · Source history may be incomplete
          </div>
        </>
      )}
    </>
  );
}
function FactRow({
  f,
  open,
  mode,
  annotate,
}: {
  f: any;
  open: (f: any) => void;
  mode: string;
  annotate?: (f: any, type: string) => void;
}) {
  return (
    <div className="fact-row">
      <div className="grow">
        <strong>{f.value}</strong>
        <small>
          {f.confidence < 0.85
            ? "Low-confidence extraction — verify source"
            : f.certainty === "uncertain"
              ? "Uncertain"
              : "Verified from record · source stated, not clinically validated"}
        </small>
        <div className="fact-meta">
          <Badge
            tone={
              ["suspected", "family-history"].includes(f.status)
                ? "amber"
                : f.status === "present"
                  ? "green"
                  : "neutral"
            }
          >
            {nice(f.status)}
          </Badge>
          <span>{date(f.effectiveDate)}</span>
          <span>{Math.round(f.confidence * 100)}% extractor confidence</span>
        </div>
        {mode === "detailed" && (
          <small>
            {f.evidence.length} evidence pointer
            {f.evidence.length > 1 ? "s" : ""} · {nice(f.certainty)}
          </small>
        )}
      </div>
      <div className="fact-actions">
        <button className="evidence-button" onClick={() => open(f)}>
          <Link2 size={14} />
          Evidence
        </button>
        {annotate && mode === "detailed" && (
          <>
            <button
              className="icon-button"
              aria-label={`Flag ${f.label}`}
              onClick={() => annotate(f, "flag")}
            >
              <Flag size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={`Annotate ${f.label}`}
              onClick={() => annotate(f, "annotation")}
            >
              <Plus size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
function Consents({ user, run, notify }: Actions & { user: User }) {
  const [items, setItems] = useState<any[]>([]),
    [busy, setBusy] = useState(false);
  const load = () =>
    run(async () =>
      setItems((await api("/consents")).filter((c: any) => !c.workflow)),
    );
  useEffect(() => {
    load();
  }, []);
  async function request(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const b: any = Object.fromEntries(data);
    b.scope = data.getAll("scope");
    b.validUntil = new Date(String(b.validUntil)).toISOString();
    setBusy(true);
    await run(async () => {
      await post("/consents/requests", b);
      notify(
        "Request sent. The patient must grant access before records can be viewed.",
      );
      form.reset();
      await load();
    });
    setBusy(false);
  }
  return (
    <>
      <Heading
        eyebrow="PATIENT-CONTROLLED ACCESS"
        title="Consent & access"
        description="Every permission has a purpose, a record scope, and an expiry."
      >
        <button className="secondary" onClick={load}>
          Refresh requests
        </button>
      </Heading>
      <WorkflowConsents user={user} run={run} notify={notify} />
      {user.role === "patient" && (
        <div className="reference-card">
          <UserRound size={20} />
          <div>
            <strong>Your patient reference</strong>
            <code>{user.patientId}</code>
            <small>
              Share this reference with your clinician to receive an access
              request.
            </small>
          </div>
        </div>
      )}
      {user.role === "doctor" && (
        <section className="panel padded">
          <h2>Request patient access</h2>
          <form onSubmit={request}>
            <div className="form-grid">
              <Field label="Patient reference">
                <input
                  name="patientId"
                  required
                  placeholder="Patient's UUID reference"
                />
              </Field>
              <Field label="Purpose">
                <select name="purpose">
                  <option value="emergency-history">Emergency history</option>
                  <option value="care-management">Care management</option>
                  <option value="follow-up">Follow-up</option>
                </select>
              </Field>
              <Field label="Record date from">
                <input type="date" name="fromDate" required />
              </Field>
              <Field label="Record date to">
                <input type="date" name="toDate" required />
              </Field>
              <Field label="Access expires (within 30 days)">
                <input type="datetime-local" name="validUntil" required />
              </Field>
            </div>
            <fieldset>
              <legend>Record scope · select at least one</legend>
              <div className="checkboxes">
                {types.map((t) => (
                  <label key={t}>
                    <input type="checkbox" name="scope" value={t} />
                    {nice(t)}
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="primary" disabled={busy}>
              <ShieldCheck size={16} />
              Send consent request
            </button>
          </form>
        </section>
      )}
      <div className="consent-list">
        {items.map((c) => (
          <section className="panel consent-card" key={c.id}>
            <div className="consent-card-top">
              <div className="file-icon">
                <Stethoscope size={23} />
              </div>
              <div className="grow">
                <h2>{c.doctorName || "Clinician access"}</h2>
                <p>
                  {nice(c.purpose)} · Requested {date(c.createdAt)}
                </p>
              </div>
              <Badge
                tone={
                  c.status === "granted"
                    ? "green"
                    : c.status === "requested"
                      ? "amber"
                      : c.status === "revoked"
                        ? "red"
                        : "neutral"
                }
              >
                {nice(c.status)}
              </Badge>
            </div>
            <div className="consent-details">
              <div>
                <span>RECORD SCOPE</span>
                <div className="scope-tags">
                  {c.scope.map((s: string) => (
                    <Badge key={s}>{nice(s)}</Badge>
                  ))}
                </div>
              </div>
              <div>
                <span>RECORD DATE RANGE</span>
                <strong>
                  {date(c.fromDate)} — {date(c.toDate)}
                </strong>
              </div>
              <div>
                <span>ACCESS EXPIRES</span>
                <strong>
                  {new Date(c.validUntil).toLocaleString("en-IN")}
                </strong>
              </div>
            </div>
            {user.role === "patient" && (
              <div className="consent-actions">
                {c.status === "requested" ? (
                  <>
                    <button
                      className="secondary"
                      onClick={() =>
                        run(async () => {
                          await post(`/consents/${c.id}/deny`);
                          await load();
                          notify("Access denied.");
                        })
                      }
                    >
                      Deny request
                    </button>
                    <button
                      className="primary"
                      onClick={() =>
                        run(async () => {
                          await post(`/consents/${c.id}/grant`);
                          await load();
                          notify(
                            "Scoped access granted. You can revoke it at any time.",
                          );
                        })
                      }
                    >
                      <Check size={16} />
                      Grant access
                    </button>
                  </>
                ) : c.status === "granted" ? (
                  <button
                    className="secondary danger"
                    onClick={() =>
                      run(async () => {
                        await post(`/consents/${c.id}/revoke`);
                        await load();
                        notify(
                          "Access revoked. Further clinical reads are blocked.",
                        );
                      })
                    }
                  >
                    Revoke access
                  </button>
                ) : null}
              </div>
            )}
          </section>
        ))}
      </div>
      {!items.length && (
        <section className="panel">
          <Empty title="No access requests" icon={ShieldCheck}>
            Requests and their full permission details will appear here.
          </Empty>
        </section>
      )}
    </>
  );
}
function Audit({ run }: { run: Actions["run"] }) {
  const [items, setItems] = useState<any[]>([]),
    [filter, setFilter] = useState("");
  const load = () => run(async () => setItems(await api("/audit/me")));
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <Heading
        eyebrow="TRANSPARENCY BY DESIGN"
        title="Access history"
        description="Clinical reads, consent decisions, and security events are recorded."
      >
        <button className="secondary" onClick={load}>
          Refresh activity
        </button>
      </Heading>
      <section className="panel">
        <div className="panel-title">
          <h2>Audit trail</h2>
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Filter activity"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter activity…"
            />
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Purpose</th>
                <th>Time</th>
                <th>Authorization</th>
              </tr>
            </thead>
            <tbody>
              {items
                .filter((e) => e.action.includes(filter))
                .map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{nice(e.action.replaceAll(".", " "))}</strong>
                      <small>Actor reference: {e.actor.slice(0, 12)}</small>
                    </td>
                    <td>{nice(e.purpose || "Account activity")}</td>
                    <td>{new Date(e.timestamp).toLocaleString("en-IN")}</td>
                    <td>
                      {e.consentId ? (
                        <Badge tone="green">Consent-linked</Badge>
                      ) : (
                        <Badge>Account / self</Badge>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!items.length && (
          <Empty title="No activity recorded" icon={History}>
            Your authorized activity will appear here.
          </Empty>
        )}
      </section>
    </>
  );
}
function Privacy({ user, run, notify }: Actions & { user: User }) {
  const [profile, setProfile] = useState<any>(null),
    [sessions, setSessions] = useState<any[]>([]),
    [secret, setSecret] = useState(""),
    [enabled, setEnabled] = useState(user.mfaEnabled);
  const load = () =>
    run(async () => {
      setSessions(await api("/auth/sessions"));
      if (user.role === "patient") setProfile(await api("/profile"));
    });
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <Heading
        eyebrow="IDENTITY & ACCOUNT"
        title={
          user.role === "patient" ? "Profile & privacy" : "Account security"
        }
        description="Manage your personal information and the sessions that can access your account."
      />
      {profile && (
        <section className="panel padded">
          <h2>Patient profile</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              run(async () => {
                setProfile(
                  await api("/profile", {
                    method: "PATCH",
                    body: JSON.stringify(b),
                  }),
                );
                notify(
                  "Profile saved. Patient declarations remain separate from clinical facts.",
                );
              });
            }}
          >
            <div className="form-grid">
              <Field label="Full name">
                <input
                  name="name"
                  defaultValue={profile.name}
                  required
                  minLength={2}
                />
              </Field>
              <Field label="Date of birth">
                <input type="date" name="dob" defaultValue={profile.dob} />
              </Field>
              <Field label="Sex">
                <select name="sex" defaultValue={profile.sex}>
                  <option value="">Not provided</option>
                  {["female", "male", "other", "prefer-not-to-say"].map((s) => (
                    <option key={s} value={s}>
                      {nice(s)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ABHA status">
                <input
                  readOnly
                  value="Not linked · sandbox integration required"
                />
              </Field>
            </div>
            <Field label="Emergency profile (patient-declared)">
              <textarea
                name="emergencyProfile"
                rows={4}
                maxLength={3000}
                defaultValue={profile.emergencyProfile}
                placeholder="Your emergency contacts or personal notes"
              />
            </Field>
            <p className="form-help">
              Patient-declared information is not promoted to evidence-backed
              clinical history.
            </p>
            <button className="primary">Save profile</button>
          </form>
        </section>
      )}
      <div className="overview-grid">
        <section className="panel padded">
          <h2>
            <KeyRound size={20} />
            Two-step verification
          </h2>
          <p>Add a time-based authenticator for stronger account protection.</p>
          {enabled ? (
            <Badge tone="green">
              <ShieldCheck size={13} />
              Authenticator enabled
            </Badge>
          ) : !secret ? (
            <button
              className="secondary"
              onClick={() =>
                run(async () =>
                  setSecret((await post("/auth/mfa/setup")).secret),
                )
              }
            >
              Set up authenticator
            </button>
          ) : (
            <>
              <Field label="Add this secret to your authenticator">
                <input readOnly value={secret} />
              </Field>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const code = new FormData(e.currentTarget).get("code");
                  run(async () => {
                    await post("/auth/mfa/confirm", { code });
                    setEnabled(true);
                    setSecret("");
                    notify("Two-step verification enabled.");
                  });
                }}
              >
                <Field label="Enter the six-digit code">
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    required
                  />
                </Field>
                <button className="primary">Verify & enable</button>
              </form>
            </>
          )}
        </section>
        <section className="panel padded">
          <h2>Active sessions</h2>
          <p>Revoke access from another session or device.</p>
          {sessions.map((s) => (
            <div className="session-row" key={s.id}>
              <div>
                <strong>{s.current ? "This session" : "Other session"}</strong>
                <small>
                  Expires {new Date(s.expires).toLocaleTimeString("en-IN")}
                </small>
              </div>
              {s.current ? (
                <Badge tone="green">Current</Badge>
              ) : (
                <button
                  className="text-button danger"
                  onClick={() =>
                    run(async () => {
                      await api(`/auth/sessions/${s.id}`, { method: "DELETE" });
                      await load();
                    })
                  }
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </section>
      </div>
      <section className="panel padded">
        <h2>Data controls</h2>
        <p>
          Delete an uploaded record from Medical records to remove its original
          and extracted facts. Access grants can be revoked from Consent &
          access. Audit events remain append-only.
        </p>
        <p className="form-help">
          This development build uses separate encrypted stores on one machine.
          Production isolation, governed retention, and account erasure
          workflows require further work.
        </p>
      </section>
    </>
  );
}
function Hospital({
  view,
  run,
  notify,
  navigate,
}: Actions & { view: string; navigate: (s: string) => void }) {
  const [data, setData] = useState<any>(null),
    [integration, setIntegration] = useState<any>(null);
  const load = () =>
    run(async () => {
      setData(await api("/hospital"));
      setIntegration(await api("/integrations/abdm/health"));
    });
  useEffect(() => {
    load();
  }, []);
  if (!data)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        Loading organization…
      </div>
    );
  const titles: Record<string, string> = {
    home: "Hospital overview",
    doctors: "Clinicians",
    departments: "Departments",
    integrations: "Connected systems",
    policies: "Organization policies",
  };
  return (
    <>
      <Heading
        eyebrow={data.organization?.name || "HOSPITAL WORKSPACE"}
        title={titles[view]}
        description="Govern access, verified affiliations, and operational controls."
      >
        <Badge tone="green">
          <ShieldCheck size={14} />
          Administrative access only
        </Badge>
      </Heading>
      {view === "home" && (
        <>
          <div className="stats">
            <Stat
              label="Clinicians"
              value={data.doctors.length}
              detail="Affiliated with your organization"
              icon={Stethoscope}
            />
            <Stat
              label="Verified clinicians"
              value={data.doctors.filter((d: any) => d.verified).length}
              detail="Eligible to request patient consent"
              icon={ShieldCheck}
            />
            <Stat
              label="Departments"
              value={data.departments.length}
              detail="Organization care teams"
              icon={Building2}
            />
          </div>
          <div className="overview-grid">
            <section className="panel padded">
              <h2>Access governance</h2>
              <p>
                Hospital privileges manage clinicians and policies. Clinical
                histories require a separate verified clinician account and
                patient consent.
              </p>
              <button className="secondary" onClick={() => navigate("doctors")}>
                Manage clinicians
                <ArrowRight size={17} />
              </button>
            </section>
            <section className="panel padded">
              <h2>Audit integrity</h2>
              <Badge tone={data.auditIntegrity.valid ? "green" : "red"}>
                {data.auditIntegrity.valid
                  ? "Hash chain verified"
                  : "Integrity failure"}
              </Badge>
              <p>
                {data.auditIntegrity.count} events checked in the local audit
                chain.
              </p>
              <button className="secondary" onClick={() => navigate("audit")}>
                Review organization events
              </button>
            </section>
          </div>
          <section className="panel padded">
            <h2>Integration readiness</h2>
            <Badge tone="amber">ABDM not configured</Badge>
            <p>
              Current sandbox validation and HIU credentials are required before
              medical record exchange.
            </p>
            <button
              className="text-button"
              onClick={() => navigate("integrations")}
            >
              View integration details
              <ArrowRight size={16} />
            </button>
          </section>
        </>
      )}
      {view === "doctors" && (
        <>
          <section className="panel padded">
            <h2>Provision clinician</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const b = Object.fromEntries(new FormData(form));
                run(async () => {
                  await post("/hospital/doctors", b);
                  form.reset();
                  await load();
                  notify(
                    "Clinician created. Verify their professional credentials before enabling access.",
                  );
                });
              }}
            >
              <div className="form-grid">
                <Field label="Full name">
                  <input name="name" required minLength={2} />
                </Field>
                <Field label="Email">
                  <input type="email" name="email" required />
                </Field>
                <Field label="Initial password">
                  <input
                    type="password"
                    name="password"
                    required
                    minLength={12}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Professional reference">
                  <input name="professionalRef" required minLength={3} />
                </Field>
                <Field label="Department">
                  <select name="department">
                    <option value="">Unassigned</option>
                    {data.departments.map((d: any) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <button className="primary">
                <Plus size={16} />
                Create clinician
              </button>
            </form>
          </section>
          <section className="panel">
            <div className="panel-title">
              <h2>Affiliated clinicians</h2>
            </div>
            {data.doctors.map((d: any) => (
              <div className="list-row" key={d.id}>
                <span className="avatar">{d.name[0]}</span>
                <div className="grow">
                  <strong>{d.name}</strong>
                  <small>
                    {d.email} · {d.department || "Unassigned"} ·{" "}
                    {d.professionalRef}
                  </small>
                </div>
                <Badge
                  tone={d.disabled ? "red" : d.verified ? "green" : "amber"}
                >
                  {d.disabled
                    ? "Disabled"
                    : d.verified
                      ? "Verified"
                      : "Verification pending"}
                </Badge>
                <button
                  className="text-button"
                  onClick={() =>
                    run(async () => {
                      await api(`/hospital/doctors/${d.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({
                          verified: !d.verified,
                          disabled: d.disabled,
                        }),
                      });
                      await load();
                    })
                  }
                >
                  {d.verified ? "Unverify" : "Verify"}
                </button>
                <button
                  className="text-button danger"
                  onClick={() =>
                    run(async () => {
                      await api(`/hospital/doctors/${d.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({
                          verified: d.verified,
                          disabled: !d.disabled,
                        }),
                      });
                      await load();
                    })
                  }
                >
                  {d.disabled ? "Enable" : "Disable"}
                </button>
              </div>
            ))}
          </section>
        </>
      )}
      {view === "departments" && (
        <section className="panel padded">
          <h2>Departments</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              run(async () => {
                await post(
                  "/hospital/departments",
                  Object.fromEntries(new FormData(form)),
                );
                form.reset();
                await load();
                notify("Department added.");
              });
            }}
            className="inline-form"
          >
            <Field label="Department name">
              <input name="name" required minLength={2} />
            </Field>
            <button className="primary">
              <Plus size={16} />
              Add department
            </button>
          </form>
          {data.departments.map((d: any) => (
            <div className="list-row" key={d.id}>
              <Building2 size={20} />
              <strong>{d.name}</strong>
            </div>
          ))}
        </section>
      )}
      {view === "integrations" && (
        <section className="panel padded">
          <h2>ABDM · HIU / M3</h2>
          <Badge tone="amber">
            {nice(integration?.status || "unavailable")}
          </Badge>
          <p>{integration?.message}</p>
          <div className="mini-note">
            <Clock size={16} />
            Last successful sync: {date(integration?.lastSuccessfulSync)}
          </div>
          <p>
            <a
              href="https://sandbox.abdm.gov.in/sandbox/v3/documentation"
              target="_blank"
              rel="noreferrer"
            >
              Current ABDM sandbox documentation ↗
            </a>
          </p>
          <hr />
          <h2>HMIS signed FHIR intake</h2>
          <Badge tone={integration?.hmis === "configured" ? "green" : "amber"}>
            {nice(integration?.hmis || "not-configured")}
          </Badge>
          <p>
            The server accepts a signed, consent-correlated FHIR Bundle when an
            HMIS webhook secret is configured. Connector setup belongs in secure
            server configuration.
          </p>
        </section>
      )}
      {view === "policies" && (
        <section className="panel padded">
          <h2>Retention & operations</h2>
          <p>
            These settings record organizational policy intent. Automated
            retention enforcement is pending.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              run(async () => {
                await api("/hospital/policy", {
                  method: "PATCH",
                  body: JSON.stringify({
                    retentionDays: Number(fd.get("retentionDays")),
                    incidentContact: fd.get("incidentContact"),
                    annotationsEnabled: fd.has("annotationsEnabled"),
                  }),
                });
                await load();
                notify("Organization policy saved.");
              });
            }}
          >
            <div className="form-grid">
              <Field label="Retention policy (days)">
                <input
                  type="number"
                  name="retentionDays"
                  min={1}
                  max={3650}
                  required
                  defaultValue={data.policy?.retentionDays || 365}
                />
              </Field>
              <Field label="Incident response email">
                <input
                  type="email"
                  name="incidentContact"
                  required
                  defaultValue={data.policy?.incidentContact || ""}
                />
              </Field>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                name="annotationsEnabled"
                defaultChecked={data.policy?.annotationsEnabled !== false}
              />
              Allow clinical annotations
            </label>
            <button className="primary">Save policy</button>
          </form>
        </section>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
