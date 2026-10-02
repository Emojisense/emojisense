import {
  getPlan,
  isHigherPlan,
  METRICS,
  type Metric,
  PLAN_IDS,
  PLANS,
  type PlanId,
  periodOf,
  WEBHOOK_EVENTS,
} from "@emojisense/platform";
import {
  type CreatedWebhookResponse,
  type DeletedTenantResponse,
  isDeleteAccountConfirmed,
  type KeySummary,
  type PlanSummary,
  type TenantResponse,
  type TenantSummary,
  type TenantsResponse,
  type WebhookDeliveriesResponse,
  type WebhookDeliverySummary,
  type WebhookResponse,
  type WebhookSummary,
  type WebhooksResponse,
  type WebhookTestResponse,
} from "../../shared/contract";
import type {
  AcceptInviteResponse,
  App,
  BillingResponse,
  CustomEmoji,
  Me,
  TeamInviteSummary,
  TeamResponse,
  TeamRole,
  UpgradeResponse,
  WebhookEvent,
} from "../api";
import { FEATURE_PLAN, type Feature, planIncludes } from "../lib/plans";
import { analyticsFor, appCount, type MockDb, measure, seeded, usageFor } from "./data";

function tenantView(db: MockDb, tenant: MockDb["tenants"][number]): TenantSummary {
  const { appId: _, ...rest } = tenant;
  return { ...rest, emojiCount: db.emoji.filter((emoji) => emoji.tenantId === tenant.id).length };
}

function webhookView(db: MockDb, hook: MockDb["webhooks"][number]): WebhookSummary {
  return { ...hook, lastDelivery: db.deliveries[hook.id]?.[0] ?? null };
}

export interface MockRequest {
  method: string;
  url: URL;
  params: string[];
  json: Record<string, unknown>;
  form: FormData | null;
}

export interface MockResponse {
  status: number;
  body: unknown;
}

type Handler = (db: MockDb, request: MockRequest) => MockResponse | Promise<MockResponse>;

const ok = (body: unknown, status = 200): MockResponse => ({ status, body });
const fail = (
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): MockResponse => ({
  status,
  body: { error: { code, message, ...extra } },
});
const notFound = () => fail(404, "not_found", "This item does not exist, or it belongs to another account.");
const forbiddenRole = () =>
  fail(403, "forbidden_role", "Your role on this team cannot do that. Ask an admin.");

/** A plan gate on `plan` (the account's, or an app's owner's). */
function gate(plan: PlanId, feature: Feature): MockResponse | null {
  if (planIncludes(plan, feature)) return null;
  const required = FEATURE_PLAN[feature];
  return fail(402, "plan_required", `This is part of the ${PLANS[required].name} plan and above.`, {
    plan: required,
  });
}

const appPlan = (db: MockDb, appId: string | undefined): PlanId =>
  db.apps.find((app) => app.id === appId)?.plan ?? db.plan;

const finite = (value: number) => (Number.isFinite(value) ? value : null);

function planSummary(id: PlanId): PlanSummary {
  const plan = PLANS[id];
  return {
    id: plan.id,
    name: plan.name,
    priceUsdMonthly: plan.priceUsdMonthly,
    limits: Object.fromEntries(
      METRICS.map((metric) => [metric, finite(plan.limits[metric])]),
    ) as PlanSummary["limits"],
    maxApps: finite(plan.maxApps),
    hostedEmojiSets: plan.hostedEmojiSets,
    analyticsRetentionDays: plan.analyticsRetentionDays,
    teamMembers: plan.teamMembers,
    tenants: plan.tenants,
  };
}

const ownApps = (db: MockDb) => db.apps.filter((app) => app.role === "owner");

function me(db: MockDb): Me {
  return {
    ...db.me,
    plan: planSummary(db.plan),
    appCount: ownApps(db).length,
    waitlistPlan: db.waitlistPlan,
  };
}

function appView(db: MockDb, app: MockDb["apps"][number]): App {
  return {
    ...app,
    plan: app.role === "owner" ? db.plan : app.plan,
    activeKeyCount: db.keys.filter((key) => key.appId === app.id && key.revokedAt === null).length,
  };
}

function findApp(db: MockDb, id: string | undefined) {
  return db.apps.find((app) => app.id === id);
}

const sortKeys = (keys: KeySummary[]) =>
  [...keys].sort(
    (a, b) => Number(a.revokedAt !== null) - Number(b.revokedAt !== null) || b.createdAt - a.createdAt,
  );

let counter = 1;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;
const randomText = (length: number) => {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(
    crypto.getRandomValues(new Uint8Array(length)),
    (byte) => alphabet[byte % alphabet.length],
  ).join("");
};

const SHORTCODE = /^[a-z0-9_+-]{1,64}$/;

const ROUTES: [method: string, pattern: RegExp, handler: Handler][] = [
  ["GET", /^\/api\/me$/, (db) => ok(me(db))],
  // Mock mode keeps its data, so a reload shows the fixtures again.
  [
    "DELETE",
    /^\/api\/me$/,
    (db, req) =>
      isDeleteAccountConfirmed(db.me.account.email, req.json.confirm)
        ? ok({ ok: true })
        : fail(400, "confirmation_required", "To delete the account, send its email address in confirm.", {
            field: "confirm",
          }),
  ],
  ["POST", /^\/api\/auth\/logout$/, () => ok({ ok: true })],

  ["GET", /^\/api\/apps$/, (db) => ok({ apps: db.apps.map((app) => appView(db, app)) })],
  [
    "POST",
    /^\/api\/apps$/,
    (db, { json }) => {
      const name = String(json.name ?? "").trim();
      if (!name) return fail(400, "invalid_request", "Give the app a name.", { field: "name" });
      const count = ownApps(db).length;
      if (count >= PLANS[db.plan].maxApps) {
        const plan = PLAN_IDS.find((id) => PLANS[id].maxApps > count) ?? "scale";
        return fail(402, "plan_required", `Your ${PLANS[db.plan].name} plan allows ${count} apps.`, { plan });
      }
      const app: MockDb["apps"][number] = {
        id: newId("app"),
        name,
        environment: (json.environment as App["environment"]) ?? "prod",
        plan: db.plan,
        createdAt: Date.now(),
        emojiSet: "native",
        role: "owner",
        ownerId: db.me.account.id,
        ownerName: db.me.account.name,
      };
      db.apps.push(app);
      return ok({ app: appView(db, app) }, 201);
    },
  ],
  [
    "GET",
    /^\/api\/apps\/([^/]+)$/,
    (db, { params }) => {
      const app = findApp(db, params[0]);
      if (!app) return notFound();
      return ok({ app: appView(db, app), keys: sortKeys(db.keys.filter((key) => key.appId === app.id)) });
    },
  ],
  [
    "PATCH",
    /^\/api\/apps\/([^/]+)$/,
    (db, { params, json }) => {
      const app = findApp(db, params[0]);
      if (!app) return notFound();
      if (typeof json.emojiSet === "string" && json.emojiSet !== "native") {
        const blocked = gate(appPlan(db, app.id), "hosted_sets");
        if (blocked) return blocked;
      }
      if (typeof json.name === "string") {
        if (!json.name.trim()) return fail(400, "invalid_request", "Give the app a name.", { field: "name" });
        app.name = json.name.trim();
      }
      if (typeof json.emojiSet === "string") app.emojiSet = json.emojiSet as App["emojiSet"];
      return ok({ app: appView(db, app) });
    },
  ],
  [
    "GET",
    /^\/api\/apps\/([^/]+)\/usage$/,
    (db, { params, url }) => {
      const app = findApp(db, params[0]);
      if (!app) return notFound();
      const period = url.searchParams.get("period") ?? periodOf();
      return ok({
        appId: app.id,
        period,
        plan: { id: db.plan, name: PLANS[db.plan].name },
        metrics: usageFor(db, app.id, period),
      });
    },
  ],

  [
    "POST",
    /^\/api\/apps\/([^/]+)\/keys$/,
    (db, { params, json }) => {
      const app = findApp(db, params[0]);
      if (!app) return notFound();
      const kind = json.kind === "secret" ? "secret" : "publishable";
      const origins = kind === "publishable" ? ((json.allowedOrigins as string[] | undefined) ?? []) : [];
      if (kind === "publishable" && origins.length === 0 && app.environment !== "dev") {
        return fail(
          400,
          "invalid_origin",
          "Add at least one allowed origin. Only keys of dev apps may allow any origin.",
          {
            field: "allowedOrigins",
          },
        );
      }
      const fullKey = `${kind === "secret" ? "sk" : "pk"}_live_${randomText(32)}`;
      const key: KeySummary = {
        id: newId("key"),
        appId: app.id,
        kind,
        prefix: fullKey.slice(0, 12),
        allowedOrigins: origins,
        createdAt: Date.now(),
        revokedAt: null,
      };
      db.keys.push(key);
      return ok({ key, fullKey }, 201);
    },
  ],
  [
    "PATCH",
    /^\/api\/keys\/([^/]+)$/,
    (db, { params, json }) => {
      const key = db.keys.find((item) => item.id === params[0]);
      if (!key) return notFound();
      key.allowedOrigins = (json.allowedOrigins as string[] | undefined) ?? key.allowedOrigins;
      return ok({ key });
    },
  ],
  [
    "DELETE",
    /^\/api\/keys\/([^/]+)$/,
    (db, { params }) => {
      const key = db.keys.find((item) => item.id === params[0]);
      if (!key) return notFound();
      key.revokedAt = Date.now();
      return ok({ key });
    },
  ],

  [
    "GET",
    /^\/api\/apps\/([^/]+)\/emoji$/,
    (db, { params }) => {
      const blocked = gate(appPlan(db, params[0]), "custom_emoji");
      if (blocked) return blocked;
      const emoji = db.emoji
        .filter((item) => item.appId === params[0])
        .sort((a, b) => b.createdAt - a.createdAt);
      return ok({
        emoji: emoji.map(({ appId: _, ...item }) => item),
        used: emoji.length,
        limit: finite(PLANS[appPlan(db, params[0])].limits.custom_emoji),
      });
    },
  ],
  [
    "POST",
    /^\/api\/apps\/([^/]+)\/emoji$/,
    (db, { params, form }) => {
      const blocked = gate(appPlan(db, params[0]), "custom_emoji");
      if (blocked) return blocked;
      const file = form?.get("file");
      const shortcode = String(form?.get("shortcode") ?? "");
      if (!(file instanceof File)) return fail(400, "invalid_request", "Choose an image.", { field: "file" });
      if (!SHORTCODE.test(shortcode)) {
        return fail(400, "invalid_request", "Use 1–64 lowercase letters, digits, _ + or -.", {
          field: "shortcode",
        });
      }
      if (db.emoji.some((item) => item.appId === params[0] && item.shortcode === shortcode)) {
        return fail(409, "conflict", `:${shortcode}: already exists in this app.`, { field: "shortcode" });
      }
      const emoji: MockDb["emoji"][number] = {
        id: newId("emo"),
        appId: params[0] ?? "",
        shortcode,
        aliases: String(form?.get("aliases") ?? "")
          .split(",")
          .map((alias) => alias.trim())
          .filter(Boolean),
        imageUrl: URL.createObjectURL(file),
        tenantId: (form?.get("tenantId") as string | null) || null,
        source: "upload",
        bytes: file.size,
        createdAt: Date.now(),
      };
      db.emoji.push(emoji);
      const { appId: _, ...body } = emoji;
      return ok(body satisfies CustomEmoji, 201);
    },
  ],
  [
    "PATCH",
    /^\/api\/apps\/([^/]+)\/emoji\/([^/]+)$/,
    (db, { params, json }) => {
      const emoji = db.emoji.find((item) => item.appId === params[0] && item.id === params[1]);
      if (!emoji) return notFound();
      if (typeof json.shortcode === "string") emoji.shortcode = json.shortcode;
      if (Array.isArray(json.aliases)) emoji.aliases = json.aliases as string[];
      const { appId: _, ...body } = emoji;
      return ok(body);
    },
  ],
  [
    "DELETE",
    /^\/api\/apps\/([^/]+)\/emoji\/([^/]+)$/,
    (db, { params }) => {
      const index = db.emoji.findIndex((item) => item.appId === params[0] && item.id === params[1]);
      if (index < 0) return notFound();
      db.emoji.splice(index, 1);
      return ok({ ok: true });
    },
  ],
  [
    "POST",
    /^\/api\/apps\/([^/]+)\/emoji\/import\/(slack|discord)$/,
    (db, { json, params }) => {
      const blocked = gate(appPlan(db, params[0]), "emoji_import");
      if (blocked) return blocked;
      const token = String(json.token ?? json.botToken ?? "");
      if (token.length < 8)
        return fail(400, "invalid_token", "That token was not accepted. Check it and try again.");
      const random = seeded(`${params[1]}:${token}`);
      return ok({ imported: 12 + Math.floor(random() * 40), skipped: Math.floor(random() * 4) });
    },
  ],

  [
    "GET",
    /^\/api\/apps\/([^/]+)\/analytics$/,
    (db, { params, url }) => {
      const blocked = gate(appPlan(db, params[0]), "analytics");
      if (blocked) return blocked;
      const days = Number(url.searchParams.get("days") ?? 30);
      return ok(analyticsFor(params[0] ?? "", days, PLANS[appPlan(db, params[0])].analyticsRetentionDays));
    },
  ],

  [
    "GET",
    /^\/api\/apps\/([^/]+)\/tenants$/,
    (db, { params }) => {
      const blocked = gate(appPlan(db, params[0]), "tenants");
      if (blocked) return blocked;
      const tenants = db.tenants
        .filter((tenant) => tenant.appId === params[0])
        .sort((a, b) => a.externalId.localeCompare(b.externalId))
        .map((tenant) => tenantView(db, tenant));
      const response: TenantsResponse = { tenants, nextCursor: null };
      return ok(response);
    },
  ],
  [
    "POST",
    /^\/api\/apps\/([^/]+)\/tenants$/,
    (db, { params, json }) => {
      const blocked = gate(appPlan(db, params[0]), "tenants");
      if (blocked) return blocked;
      const externalId = String(json.externalId ?? "").trim();
      if (!externalId) return fail(400, "invalid_request", "Add an external ID.", { field: "externalId" });
      if (db.tenants.some((tenant) => tenant.appId === params[0] && tenant.externalId === externalId)) {
        return fail(409, "tenant_exists", `A tenant with the ID ${externalId} already exists.`, {
          field: "externalId",
        });
      }
      const tenant = {
        id: newId("ten"),
        appId: params[0] ?? "",
        externalId,
        name: typeof json.name === "string" ? json.name : null,
        createdAt: Date.now(),
      };
      db.tenants.push(tenant);
      const response: TenantResponse = { tenant: tenantView(db, tenant) };
      return ok(response, 201);
    },
  ],
  [
    "DELETE",
    /^\/api\/apps\/([^/]+)\/tenants\/([^/]+)$/,
    (db, { params }) => {
      const tenant = db.tenants.find((item) => item.appId === params[0] && item.id === params[1]);
      if (!tenant) return notFound();
      const response: DeletedTenantResponse = {
        tenant: tenantView(db, tenant),
        emojiDeleted: db.emoji.filter((emoji) => emoji.tenantId === tenant.id).length,
      };
      db.tenants = db.tenants.filter((item) => item.id !== tenant.id);
      db.emoji = db.emoji.filter((emoji) => emoji.tenantId !== tenant.id);
      return ok(response);
    },
  ],

  [
    "GET",
    /^\/api\/apps\/([^/]+)\/webhooks$/,
    (db, { params }) => {
      const blocked = gate(appPlan(db, params[0]), "webhooks");
      if (blocked) return blocked;
      const response: WebhooksResponse = {
        webhooks: db.webhooks.filter((hook) => hook.appId === params[0]).map((hook) => webhookView(db, hook)),
      };
      return ok(response);
    },
  ],
  [
    "POST",
    /^\/api\/apps\/([^/]+)\/webhooks$/,
    (db, { params, json }) => {
      const blocked = gate(appPlan(db, params[0]), "webhooks");
      if (blocked) return blocked;
      if (db.webhooks.filter((hook) => hook.appId === params[0]).length >= 10) {
        return fail(409, "webhook_limit", "An app can have at most 10 webhooks. Delete one first.");
      }
      const url = String(json.url ?? "");
      if (!url.startsWith("https://")) {
        return fail(400, "invalid_url", "Use an https:// URL.", { field: "url" });
      }
      const webhook: MockDb["webhooks"][number] = {
        id: newId("whk"),
        appId: params[0] ?? "",
        url,
        events: (json.events as WebhookEvent[] | undefined) ?? [...WEBHOOK_EVENTS],
        enabled: true,
        createdAt: Date.now(),
        disabledAt: null,
      };
      db.webhooks.unshift(webhook);
      db.deliveries[webhook.id] = [];
      const response: CreatedWebhookResponse = {
        webhook: webhookView(db, webhook),
        secret: `whsec_${randomText(32)}`,
      };
      return ok(response, 201);
    },
  ],
  [
    "PATCH",
    /^\/api\/webhooks\/([^/]+)$/,
    (db, { params, json }) => {
      const hook = db.webhooks.find((item) => item.id === params[0]);
      if (!hook) return notFound();
      if (typeof json.enabled === "boolean" && json.enabled !== hook.enabled) {
        hook.enabled = json.enabled;
        hook.disabledAt = json.enabled ? null : Date.now();
      }
      if (typeof json.url === "string") hook.url = json.url;
      if (Array.isArray(json.events)) hook.events = json.events as WebhookEvent[];
      const response: WebhookResponse = { webhook: webhookView(db, hook) };
      return ok(response);
    },
  ],
  [
    "DELETE",
    /^\/api\/webhooks\/([^/]+)$/,
    (db, { params }) => {
      db.webhooks = db.webhooks.filter((hook) => hook.id !== params[0]);
      delete db.deliveries[params[0] ?? ""];
      return ok({ ok: true });
    },
  ],
  [
    "POST",
    /^\/api\/webhooks\/([^/]+)\/test$/,
    (db, { params }) => {
      const hook = db.webhooks.find((item) => item.id === params[0]);
      if (!hook) return notFound();
      const delivery: WebhookDeliverySummary = {
        id: newId("dlv"),
        event: "webhook.test",
        status: 200,
        ok: true,
        durationMs: 80 + Math.round(Math.random() * 160),
        createdAt: Date.now(),
      };
      db.deliveries[hook.id] = [delivery, ...(db.deliveries[hook.id] ?? [])].slice(0, 50);
      const response: WebhookTestResponse = { delivery };
      return ok(response);
    },
  ],
  [
    "GET",
    /^\/api\/webhooks\/([^/]+)\/deliveries$/,
    (db, { params }) => {
      if (!db.webhooks.some((hook) => hook.id === params[0])) return notFound();
      const response: WebhookDeliveriesResponse = { deliveries: db.deliveries[params[0] ?? ""] ?? [] };
      return ok(response);
    },
  ],

  [
    "GET",
    /^\/api\/team$/,
    (db, { url }) => {
      const owner = url.searchParams.get("owner");
      if (owner && owner !== db.me.account.id) {
        if (owner !== db.otherTeam.ownerId || !db.me.teams.some((team) => team.ownerId === owner))
          return notFound();
        const response: TeamResponse = {
          ownerId: owner,
          role: "developer",
          members: db.otherTeam.members,
          invites: [],
        };
        return ok(response);
      }
      const response: TeamResponse = {
        ownerId: db.me.account.id,
        role: "owner",
        members: db.members,
        invites: db.invites.filter((invite) => invite.expiresAt > Date.now()),
      };
      return gate(db.plan, "team") ?? ok(response);
    },
  ],
  [
    "POST",
    /^\/api\/team\/invites$/,
    (db, { json, url }) => {
      if (url.searchParams.get("owner")) return forbiddenRole();
      const blocked = gate(db.plan, "team");
      if (blocked) return blocked;
      const invite: TeamInviteSummary = {
        id: newId("inv"),
        role: (json.role as TeamRole) ?? "developer",
        email: typeof json.email === "string" ? json.email : null,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 86_400_000,
      };
      db.invites.unshift(invite);
      return ok({ invite, url: `${url.origin}/invite/${randomText(24)}` }, 201);
    },
  ],
  [
    "DELETE",
    /^\/api\/team\/invites\/([^/]+)$/,
    (db, { params, url }) => {
      if (url.searchParams.get("owner")) return forbiddenRole();
      db.invites = db.invites.filter((invite) => invite.id !== params[0]);
      return ok({ ok: true });
    },
  ],
  [
    "PATCH",
    /^\/api\/team\/members\/([^/]+)$/,
    (db, { params, json, url }) => {
      if (url.searchParams.get("owner")) return forbiddenRole();
      const member = db.members.find((item) => item.id === params[0]);
      if (!member) return notFound();
      if (member.role === "owner") return fail(409, "owner_immutable", "The owner's role cannot change.");
      member.role = json.role as TeamRole;
      return ok({ member });
    },
  ],
  [
    "DELETE",
    /^\/api\/team\/members\/([^/]+)$/,
    (db, { params, url }) => {
      const owner = url.searchParams.get("owner");
      if (owner) {
        // A member may leave another owner's team; nothing else.
        if (params[0] !== db.me.account.id) return forbiddenRole();
        db.me.teams = db.me.teams.filter((team) => team.ownerId !== owner);
        db.apps = db.apps.filter((app) => app.ownerId !== owner);
        return ok({ ok: true });
      }
      if (params[0] === db.me.account.id)
        return fail(409, "owner_immutable", "The owner cannot leave their own team.");
      db.members = db.members.filter((member) => member.id !== params[0]);
      return ok({ ok: true });
    },
  ],
  [
    "POST",
    /^\/api\/invites\/([^/]+)\/accept$/,
    (_, { params }) => {
      if (params[0] === "expired") return fail(410, "invite_expired", "This invite expired.");
      if (params[0] === "used") return fail(410, "invite_used", "This invite was already used.");
      const response: AcceptInviteResponse = {
        team: { ownerId: "acc_jonas", ownerName: "Jonas Weber", role: "developer" },
      };
      return ok(response);
    },
  ],

  [
    "GET",
    /^\/api\/billing$/,
    (db) => {
      const plan = PLANS[db.plan];
      const apps = ownApps(db);
      // Account totals; custom_emoji is the number of emoji stored now.
      const used = (metric: Metric) =>
        apps.reduce((sum, app) => sum + appCount(db, app.id, metric, periodOf()), 0);
      const response: BillingResponse = {
        plan: planSummary(db.plan),
        period: periodOf(),
        usage: METRICS.map((metric) => measure(metric, used(metric), plan.limits[metric])),
        limits: {
          ...(Object.fromEntries(METRICS.map((metric) => [metric, finite(plan.limits[metric])])) as Record<
            Metric,
            number | null
          >),
          apps: finite(plan.maxApps),
        },
        appCount: apps.length,
        provider: null,
        waitlistPlan: db.waitlistPlan,
      };
      return ok(response);
    },
  ],
  [
    "POST",
    /^\/api\/billing\/upgrade$/,
    (db, { json }) => {
      const plan = getPlan(String(json.plan)).id;
      if (!isHigherPlan(plan, db.plan)) {
        return fail(409, "plan_not_higher", "Choose a plan above your current one.");
      }
      db.waitlistPlan = plan;
      const response: UpgradeResponse = { status: "waitlist", plan };
      return ok(response);
    },
  ],
  [
    "POST",
    /^\/api\/waitlist$/,
    (db, { json }) => {
      db.waitlistPlan = getPlan(String(json.plan)).id;
      return ok({ ok: true, plan: db.waitlistPlan });
    },
  ],
];

export async function handle(db: MockDb, request: Omit<MockRequest, "params">): Promise<MockResponse> {
  for (const [method, pattern, handler] of ROUTES) {
    if (method !== request.method) continue;
    const match = pattern.exec(request.url.pathname);
    if (match) return handler(db, { ...request, params: match.slice(1).map(decodeURIComponent) });
  }
  return fail(404, "not_found", `Mock mode has no route for ${request.method} ${request.url.pathname}.`);
}
