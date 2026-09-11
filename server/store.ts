import { auditContext } from "./audit-context";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { resolve } from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import { dataDir, seal, unseal, key } from "./security";
import type { Entity } from "./types";
import { workflowTables, migrationStatements } from "./migrations/002-workflow";
type Domain = "identity" | "clinical" | "consent" | "audit";
export class Store {
  private sqlite = new Map<Domain, DatabaseSync>();
  private pool?: Pool;
  private auditLock: Promise<unknown> = Promise.resolve();
  async init() {
    if (process.env.DATABASE_URL)
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    for (const d of ["identity", "clinical", "consent", "audit"] as Domain[]) {
      if (this.pool) await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${d}`);
      else {
        const db = new DatabaseSync(resolve(dataDir, `${d}.sqlite`));
        db.exec(
          "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
        );
        this.sqlite.set(d, db);
      }
      await this.run(
        d,
        `CREATE TABLE IF NOT EXISTS ${this.table(d)} (id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner TEXT NOT NULL, tenant TEXT NOT NULL, payload TEXT NOT NULL)`,
      );
      await this.run(
        d,
        `CREATE INDEX IF NOT EXISTS ${d}_owner_kind ON ${this.table(d)} (owner, kind)`,
      );
      await this.run(
        d,
        `CREATE INDEX IF NOT EXISTS ${d}_tenant_kind ON ${this.table(d)} (tenant, kind)`,
      );
      if (d === "audit" && !this.pool)
        this.sqlite
          .get(d)!
          .exec(
            "CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON entities BEGIN SELECT RAISE(ABORT, 'audit is append only'); END; CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON entities BEGIN SELECT RAISE(ABORT, 'audit is append only'); END;",
          );
      for (const sql of migrationStatements(d, !!this.pool))
        await this.run(d, sql);
      for (const kind of Object.keys(workflowTables[d] || {}))
        for (const entity of await this.list(d, kind))
          await this.indexEntity(d, entity);
    }
  }
  private async indexEntity(d: Domain, entity: Entity) {
    const t = workflowTables[d]?.[entity.kind];
    if (!t) return;
    const name = this.pool ? d + "." + t : t;
    await this.run(
      d,
      "INSERT INTO " +
        name +
        "(id,owner_ref,tenant_ref,parent_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner_ref=excluded.owner_ref,tenant_ref=excluded.tenant_ref,parent_id=excluded.parent_id",
      [
        entity.id,
        entity.owner,
        entity.tenant,
        entity.parentId || null,
        entity.createdAt || entity.receivedAt || new Date().toISOString(),
      ],
    );
  }
  private table(d: Domain) {
    return this.pool ? `${d}.entities` : "entities";
  }
  private encryption(d: Domain) {
    return d === "identity" ? "IDENTITY" : d === "audit" ? "AUDIT" : "CLINICAL";
  }
  private async run(
    d: Domain,
    sql: string,
    args: any[] = [],
    read = false,
  ): Promise<any[]> {
    if (this.pool) {
      let i = 0;
      return (
        await this.pool.query(
          sql.replace(/\?/g, () => `$${++i}`),
          args,
        )
      ).rows;
    }
    const stmt = this.sqlite.get(d)!.prepare(sql);
    return read ? stmt.all(...args) : (stmt.run(...args), []);
  }
  async put<T extends Entity>(d: Domain, entity: T): Promise<T> {
    if (d === "audit") throw new Error("Use append-only audit API");
    if (d === "clinical" && entity.kind === "fact") {
      if (!Array.isArray(entity.evidence) || entity.evidence.length === 0)
        throw new Error("Clinical facts require source evidence");
      for (const pointer of entity.evidence) {
        const source = await this.get("clinical", pointer.documentId);
        if (
          !source ||
          source.kind !== "document" ||
          source.owner !== entity.owner ||
          source.hash !== pointer.sourceHash ||
          typeof pointer.span !== "string" ||
          !pointer.span.trim()
        )
          throw new Error(
            "Clinical fact evidence failed provenance validation",
          );
      }
    }
    await this.run(
      d,
      `INSERT INTO ${this.table(d)} (id,kind,owner,tenant,payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,tenant=excluded.tenant,payload=excluded.payload`,
      [
        entity.id,
        entity.kind,
        entity.owner,
        entity.tenant,
        seal(JSON.stringify(entity), this.encryption(d)),
      ],
    );
    await this.indexEntity(d, entity);
    return entity;
  }
  async get<T extends Entity = Entity>(
    d: Domain,
    id: string,
  ): Promise<T | undefined> {
    const rows = await this.run(
      d,
      `SELECT payload FROM ${this.table(d)} WHERE id=?`,
      [id],
      true,
    );
    return rows[0]
      ? JSON.parse(unseal(rows[0].payload, this.encryption(d)).toString())
      : undefined;
  }
  async list<T extends Entity = Entity>(
    d: Domain,
    kind: string,
    filter: { owner?: string; tenant?: string } = {},
  ): Promise<T[]> {
    let sql = `SELECT payload FROM ${this.table(d)} WHERE kind=?`;
    const args = [kind];
    for (const k of ["owner", "tenant"] as const)
      if (filter[k] !== undefined) {
        sql += ` AND ${k}=?`;
        args.push(filter[k]!);
      }
    return (await this.run(d, sql, args, true)).map((row) =>
      JSON.parse(unseal(row.payload, this.encryption(d)).toString()),
    );
  }
  async remove(d: Exclude<Domain, "audit">, id: string) {
    for (const table of Object.values(workflowTables[d] || {})) {
      const name = this.pool ? d + "." + table : table;
      for (const child of await this.run(
        d,
        "SELECT id FROM " + name + " WHERE parent_id=?",
        [id],
        true,
      ))
        if (child.id !== id) await this.remove(d, child.id);
    }
    await this.run(d, `DELETE FROM ${this.table(d)} WHERE id=?`, [id]);
  }
  async audit(
    actor: string,
    patientId: string,
    action: string,
    tenant: string,
    purpose = "",
    consentId = "",
    metadata: Record<string, unknown> = {},
  ) {
    // Serialized in-process; PostgreSQL advisory transaction lock also serializes across replicas.
    const next = this.auditLock.then(async () => {
      const client = this.pool ? await this.pool.connect() : undefined;
      try {
        if (client) {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(71001)");
        }
        const rows = client
          ? (
              await client.query(
                "SELECT payload FROM audit.entities WHERE kind=$1",
                ["audit"],
              )
            ).rows
          : await this.run(
              "audit",
              "SELECT payload FROM entities WHERE kind=?",
              ["audit"],
              true,
            );
        const events = rows
          .map((r) => JSON.parse(unseal(r.payload, "AUDIT").toString()))
          .sort((a, b) => a.sequence - b.sequence);
        const prev = events.at(-1);
        const event = {
          id: randomUUID(),
          kind: "audit",
          owner: patientId,
          tenant,
          actor,
          action,
          purpose,
          consentId,
          metadata,
          actorRole:
            auditContext.getStore()?.actorRole ||
            metadata.actorRole ||
            "service",
          ip: auditContext.getStore()?.ip || metadata.ip || "unavailable",
          sessionId:
            auditContext.getStore()?.sessionId ||
            metadata.sessionId ||
            "system",
          device:
            auditContext.getStore()?.device || metadata.device || "unavailable",
          resource:
            metadata.resource ||
            metadata.factId ||
            metadata.documentId ||
            consentId ||
            patientId,
          timestamp: new Date().toISOString(),
          sequence: (prev?.sequence || 0) + 1,
          previousHash: prev?.hash || "GENESIS",
        };
        const digest = createHmac("sha256", key("AUDIT"))
          .update(JSON.stringify(event))
          .digest("hex");
        const result = { ...event, hash: digest };
        const args = [
          result.id,
          "audit",
          patientId,
          tenant,
          seal(JSON.stringify(result), "AUDIT"),
        ];
        if (client) {
          await client.query(
            "INSERT INTO audit.entities (id,kind,owner,tenant,payload) VALUES ($1,$2,$3,$4,$5)",
            args,
          );
          await client.query("COMMIT");
        } else
          await this.run(
            "audit",
            "INSERT INTO entities (id,kind,owner,tenant,payload) VALUES (?,?,?,?,?)",
            args,
          );
        return result;
      } catch (e) {
        if (client) await client.query("ROLLBACK");
        throw e;
      } finally {
        client?.release();
      }
    });
    this.auditLock = next.catch(() => {});
    return next;
  }
  async verifyAudit() {
    const events = (await this.list("audit", "audit")).sort(
      (a, b) => a.sequence - b.sequence,
    );
    let previous = "GENESIS";
    let sequence = 0;
    for (const e of events) {
      const { hash, ...content } = e;
      if (
        e.previousHash !== previous ||
        e.sequence !== ++sequence ||
        createHmac("sha256", key("AUDIT"))
          .update(JSON.stringify(content))
          .digest("hex") !== hash
      )
        return { valid: false, count: events.length };
      previous = hash;
    }
    return { valid: true, count: events.length, head: previous };
  }
  async close() {
    for (const db of this.sqlite.values()) db.close();
    await this.pool?.end();
  }
}
export const store = new Store();
