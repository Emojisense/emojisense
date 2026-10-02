import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, PlanRequiredError, request, toApiError, UNAUTHORIZED_EVENT } from "../../src/app/api";
import { stubApi } from "./fake-api";

describe("toApiError", () => {
  it("reads the code, message and field of the shared error body", () => {
    const error = toApiError(400, {
      error: { code: "invalid_request", message: "name cannot be empty.", field: "name" },
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(PlanRequiredError);
    expect([error.status, error.code, error.message, error.field]).toEqual([
      400,
      "invalid_request",
      "name cannot be empty.",
      "name",
    ]);
  });

  it("turns 402 plan_required into a PlanRequiredError that names the plan", () => {
    const error = toApiError(402, {
      error: { code: "plan_required", message: "Analytics are part of Pro.", plan: "pro" },
    });
    expect(error).toBeInstanceOf(PlanRequiredError);
    expect((error as PlanRequiredError).plan).toBe("pro");
    expect(error.message).toBe("Analytics are part of Pro.");
  });

  it("names a real plan even when the 402 body has none", () => {
    expect((toApiError(402, null) as PlanRequiredError).plan).toBe("pro");
    expect(
      (toApiError(402, { error: { code: "plan_required", plan: "gold" } }) as PlanRequiredError).plan,
    ).toBe("pro");
  });

  it("gives a readable message when the body is not the API's JSON", () => {
    expect(toApiError(502, "<html>Bad gateway</html>").message).toBe(
      "The dashboard API had a problem. Try again in a moment.",
    );
    expect(toApiError(429, null).message).toBe("Too many requests. Wait a minute, then try again.");
    expect(toApiError(418, {}).code).toBe("http_error");
  });
});

describe("request", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends JSON with a content type, and FormData without one", async () => {
    const seen: { headers: Record<string, string>; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (_input: string, init: RequestInit) => {
      seen.push({ headers: init.headers as Record<string, string>, body: init.body });
      return new Response("{}", { status: 200 });
    });

    await request("POST", "/api/apps", { name: "Relay" });
    const form = new FormData();
    form.set("shortcode", "shipit");
    await request("POST", "/api/apps/app_1/emoji", form);

    expect(seen[0]?.headers["content-type"]).toBe("application/json");
    expect(seen[0]?.body).toBe('{"name":"Relay"}');
    // The browser sets the multipart boundary itself.
    expect(seen[1]?.headers["content-type"]).toBeUndefined();
    expect(seen[1]?.body).toBe(form);
  });

  it("announces a 401 so the app can return to the sign-in page", async () => {
    stubApi({
      "GET /api/me": { status: 401, body: { error: { code: "unauthorized", message: "Sign in." } } },
    });
    const onUnauthorized = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    await expect(request("GET", "/api/me")).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("reports a network failure as status 0", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(request("GET", "/api/me")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });
});

describe("endpoints", () => {
  it("pages tenants with a cursor and acts on another owner's team with ?owner=", async () => {
    const { calls } = stubApi({
      "GET /api/apps/app_1/tenants": { body: { tenants: [], nextCursor: null } },
      "GET /api/team": { body: { ownerId: "acc_2", role: "developer", members: [], invites: [] } },
      "DELETE /api/team/members/acc_1": { body: { ok: true } },
    });
    await api.listTenants("app_1", "acme co");
    await api.team("acc_2");
    await api.removeMember("acc_1", "acc_2");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/apps/app_1/tenants?limit=100&cursor=acme%20co",
      "GET /api/team?owner=acc_2",
      "DELETE /api/team/members/acc_1?owner=acc_2",
    ]);
  });

  it("uploads custom emoji as multipart and accepts a wrapped or a bare answer", async () => {
    const forms: FormData[] = [];
    const emoji = {
      id: "emo_1",
      shortcode: "shipit",
      aliases: ["ship it"],
      imageUrl: "https://api.example/v1/custom/app_1/emo_1",
      tenantId: "",
      source: "upload",
      bytes: 812,
      createdAt: 1,
    };
    const answers = [{ emoji }, emoji];
    vi.stubGlobal("fetch", async (_input: string, init: RequestInit) => {
      forms.push(init.body as FormData);
      return new Response(JSON.stringify(answers.shift()), { status: 201 });
    });
    const file = new File(["<svg/>"], "shipit.svg", { type: "image/svg+xml" });

    const wrapped = await api.uploadEmoji("app_1", {
      file,
      shortcode: "shipit",
      aliases: ["ship it", "launch"],
    });
    const bare = await api.uploadEmoji("app_1", {
      file,
      shortcode: "shipit",
      aliases: [],
      tenantId: "ten_1",
    });

    expect(forms[0]?.get("aliases")).toBe("ship it,launch");
    expect(forms[0]?.get("tenantId")).toBeNull();
    expect(forms[1]?.get("tenantId")).toBe("ten_1");
    expect((forms[0]?.get("file") as File | undefined)?.name).toBe("shipit.svg");
    // An empty tenantId means app-wide.
    expect(wrapped.tenantId).toBeNull();
    expect(bare.id).toBe("emo_1");
  });
});
