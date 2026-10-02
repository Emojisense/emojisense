/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { isHigherPlan, lowestPlanWith, PLAN_IDS } from "../src/plans.js";
import {
  type AccountRow,
  CUSTOM_EMOJI_CONTENT_TYPES,
  CUSTOM_EMOJI_SOURCES,
  type CustomEmojiRow,
  EMOJI_SETS,
  type QueryDailyRow,
  TEAM_ROLES,
  type TeamInviteRow,
  type TeamMemberRow,
  type TenantRow,
  type WebhookDeliveryRow,
  type WebhookRow,
} from "../src/types.js";

const MIGRATIONS = new URL("../migrations/", import.meta.url);

/** Every migration in file-name order, as `wrangler d1 migrations apply` runs them. */
function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  return db;
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).sort();
}

/** One object per row type lists its keys at compile time; the test compares them to the table. */
const ROW_KEYS: Record<string, readonly string[]> = {
  team_members: Object.keys({ owner_id: "", member_id: "", role: "admin", created_at: 0 } satisfies Record<
    keyof TeamMemberRow,
    unknown
  >),
  team_invites: Object.keys({
    id: "",
    owner_id: "",
    role: "admin",
    token_hash: "",
    email: null,
    created_at: 0,
    expires_at: 0,
    accepted_at: null,
  } satisfies Record<keyof TeamInviteRow, unknown>),
  tenants: Object.keys({ id: "", app_id: "", external_id: "", name: null, created_at: 0 } satisfies Record<
    keyof TenantRow,
    unknown
  >),
  custom_emoji: Object.keys({
    id: "",
    app_id: "",
    tenant_id: "",
    shortcode: "",
    aliases: "",
    image_key: "",
    content_type: "image/png",
    bytes: 0,
    source: "upload",
    created_at: 0,
  } satisfies Record<keyof CustomEmojiRow, unknown>),
  webhooks: Object.keys({
    id: "",
    app_id: "",
    url: "",
    secret: "",
    events: "",
    created_at: 0,
    disabled_at: null,
  } satisfies Record<keyof WebhookRow, unknown>),
  webhook_deliveries: Object.keys({
    id: "",
    webhook_id: "",
    event: "",
    status: null,
    duration_ms: null,
    created_at: 0,
  } satisfies Record<keyof WebhookDeliveryRow, unknown>),
  query_daily: Object.keys({ app_id: "", day: "", query: "", searches: 0, misses: 0 } satisfies Record<
    keyof QueryDailyRow,
    unknown
  >),
};

describe("row types of migration 0002", () => {
  it.each(Object.entries(ROW_KEYS))("%s has exactly the typed columns", (table, keys) => {
    expect(columns(migratedDb(), table)).toEqual([...keys].sort());
  });

  it("adds the plan to accounts and the emoji set to apps", () => {
    const db = migratedDb();
    expect(columns(db, "accounts")).toContain("plan");
    expect(columns(db, "apps")).toContain("emoji_set");
  });
});

describe("migration 0003 (Clerk sign-in)", () => {
  it("gives accounts exactly the typed columns", () => {
    const keys = Object.keys({
      id: "",
      email: null,
      github_id: null,
      clerk_user_id: null,
      name: null,
      plan: "free",
      created_at: 0,
    } satisfies Record<keyof AccountRow, unknown>);
    expect(columns(migratedDb(), "accounts")).toEqual(keys.sort());
  });

  it("keeps legacy GitHub accounts and allows one account per Clerk user", () => {
    const db = new DatabaseSync(":memory:");
    for (const file of ["0001_init.sql", "0002_product.sql"]) {
      db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
    }
    db.exec(`INSERT INTO accounts (id, email, github_id, name, created_at)
             VALUES ('legacy', 'octo@example.com', '42', 'Octo', 0)`);
    db.exec(readFileSync(new URL("0003_clerk.sql", MIGRATIONS), "utf8"));

    expect(db.prepare("SELECT id, email, github_id, clerk_user_id FROM accounts").all()).toEqual([
      { id: "legacy", email: "octo@example.com", github_id: "42", clerk_user_id: null },
    ]);
    db.exec(`INSERT INTO accounts (id, clerk_user_id, created_at) VALUES ('a', 'user_1', 0), ('b', NULL, 0)`);
    expect(() =>
      db.exec(`INSERT INTO accounts (id, clerk_user_id, created_at) VALUES ('c', 'user_1', 0)`),
    ).toThrow(/UNIQUE/);
  });
});

describe("value lists mirror the CHECK constraints", () => {
  function seed(db: DatabaseSync) {
    db.exec(`INSERT INTO accounts (id, created_at) VALUES ('owner', 0), ('member', 0);
             INSERT INTO apps (id, account_id, name, created_at) VALUES ('app', 'owner', 'App', 0);`);
  }

  it("accepts every emoji set and rejects others", () => {
    const db = migratedDb();
    seed(db);
    for (const set of EMOJI_SETS) db.prepare("UPDATE apps SET emoji_set = ?").run(set);
    expect(() => db.prepare("UPDATE apps SET emoji_set = ?").run("openmoji")).toThrow(/CHECK/);
  });

  it("accepts every team role and rejects owner", () => {
    const db = migratedDb();
    seed(db);
    const insert = db.prepare("INSERT OR REPLACE INTO team_members VALUES ('owner', 'member', ?, 0)");
    for (const role of TEAM_ROLES) insert.run(role);
    expect(() => insert.run("owner")).toThrow(/CHECK/);
  });

  it("accepts every custom emoji type and source", () => {
    const db = migratedDb();
    seed(db);
    const insert = db.prepare(
      `INSERT INTO custom_emoji (id, app_id, shortcode, image_key, content_type, bytes, source, created_at)
       VALUES (?, 'app', ?, 'k', ?, 1, ?, 0)`,
    );
    CUSTOM_EMOJI_CONTENT_TYPES.forEach((type, i) => {
      insert.run(`t${i}`, `t${i}`, type, CUSTOM_EMOJI_SOURCES[i % CUSTOM_EMOJI_SOURCES.length] ?? "upload");
    });
    CUSTOM_EMOJI_SOURCES.forEach((source, i) => {
      insert.run(`s${i}`, `s${i}`, "image/png", source);
    });
    expect(() => insert.run("x", "x", "image/jpeg", "upload")).toThrow(/CHECK/);
  });

  it("moves the best app plan to the account", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("0001_init.sql", MIGRATIONS), "utf8"));
    db.exec(`INSERT INTO accounts (id, created_at) VALUES ('a', 0), ('b', 0), ('c', 0);
             INSERT INTO apps (id, account_id, name, plan, created_at) VALUES
               ('a1', 'a', 'A1', 'solo', 0), ('a2', 'a', 'A2', 'scale', 0), ('b1', 'b', 'B1', 'free', 0);`);
    db.exec(readFileSync(new URL("0002_product.sql", MIGRATIONS), "utf8"));
    expect(db.prepare("SELECT id, plan FROM accounts ORDER BY id").all()).toEqual([
      { id: "a", plan: "scale" },
      { id: "b", plan: "free" },
      { id: "c", plan: "free" },
    ]);
  });
});

describe("plan helpers", () => {
  it("names the cheapest plan with a feature", () => {
    expect(lowestPlanWith((p) => p.hostedEmojiSets)).toBe("solo");
    expect(lowestPlanWith((p) => p.teamMembers)).toBe("pro");
    expect(lowestPlanWith((p) => p.tenants)).toBe("scale");
    expect(lowestPlanWith((p) => p.maxApps > 3)).toBe("scale");
    expect(lowestPlanWith(() => false)).toBeUndefined();
  });

  it("orders plans by price", () => {
    expect(isHigherPlan("pro", "solo")).toBe(true);
    expect(isHigherPlan("solo", "solo")).toBe(false);
    expect(isHigherPlan("free", "scale")).toBe(false);
    expect(PLAN_IDS[0]).toBe("free");
  });
});
