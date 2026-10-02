// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaitlistForm } from "../src/islands/WaitlistForm";

const PLANS = {
  solo: { name: "Solo", price: "$5 a month" },
  pro: { name: "Pro", price: "$20 a month" },
  scale: { name: "Scale", price: "$100 a month" },
};

function setup(fetch: typeof globalThis.fetch) {
  render(<WaitlistForm endpoint="https://dashboard.test/api/waitlist" plans={PLANS} fetch={fetch} />);
  return {
    email: screen.getByLabelText("Email") as HTMLInputElement,
    plan: screen.getByLabelText("Plan") as HTMLSelectElement,
    submit: screen.getByRole("button", { name: "Join the waitlist" }),
  };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("WaitlistForm", () => {
  it("shows an inline field error and sends nothing for an empty address", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const { email, submit } = setup(fetch);
    fireEvent.click(submit);
    expect(await screen.findByText("Enter your email address.")).toBeTruthy();
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("replaces the form with a confirmation after the server accepts", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{}", { status: 201 }));
    const { email, plan, submit } = setup(fetch);
    fireEvent.change(email, { target: { value: "ada@example.com" } });
    fireEvent.change(plan, { target: { value: "scale" } });
    fireEvent.click(submit);
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("You are on the list");
    expect(status.textContent).toContain("ada@example.com");
    expect(status.textContent).toContain("Scale");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      email: "ada@example.com",
      plan: "scale",
    });
  });

  it("keeps the form and shows an alert when the server fails", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{}", { status: 500 }));
    const { email, submit } = setup(fetch);
    fireEvent.change(email, { target: { value: "ada@example.com" } });
    fireEvent.click(submit);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not available right now/);
    expect(screen.getByLabelText("Email")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Join the waitlist" })).toBeTruthy());
  });

  it("preselects the plan from the ?plan= link", async () => {
    window.history.replaceState(null, "", "/waitlist/?plan=solo");
    const { plan } = setup(vi.fn<typeof globalThis.fetch>());
    await waitFor(() => expect(plan.value).toBe("solo"));
  });
});
