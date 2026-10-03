import { DEMO_USERS } from "@deeproot/demo";
import { describe, expect, it } from "vitest";
import { DEMO_USER, resolveUser } from "./access.js";

const header = (principal: unknown) => Buffer.from(JSON.stringify(principal)).toString("base64");

describe("resolveUser", () => {
  it("acts as the demo presenter when sign-in is off (the default), whatever the header says", () => {
    expect(resolveUser(undefined, {})).toEqual({ userId: DEMO_USERS.presenter });
    expect(resolveUser(header({ userDetails: "betaco-lead" }), {})).toBe(DEMO_USER);
  });

  it("uses the GitHub username from Static Web Apps when REQUIRE_SIGN_IN=true", () => {
    const env = { REQUIRE_SIGN_IN: "true" };
    expect(resolveUser(header({ identityProvider: "github", userDetails: "octocat" }), env)).toEqual({ userId: "octocat" });
  });

  it("treats a missing or malformed header as signed out when sign-in is required", () => {
    const env = { REQUIRE_SIGN_IN: "true" };
    expect(resolveUser(undefined, env)).toBeNull();
    expect(resolveUser("not base64 json", env)).toBeNull();
    expect(resolveUser(header({ userDetails: "" }), env)).toBeNull();
  });
});
