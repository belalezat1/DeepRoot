import { describe, expect, it } from "vitest";
import { requestUser, userFromPrincipal } from "./principal.js";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

describe("userFromPrincipal", () => {
  it("uses userDetails from the Static Web Apps principal", () => {
    const header = encode({ identityProvider: "github", userId: "abc123", userDetails: "presenter", userRoles: ["anonymous", "authenticated"] });
    expect(userFromPrincipal(header)).toEqual({ userId: "presenter" });
  });

  it("treats a missing, unreadable or empty principal as signed out", () => {
    expect(userFromPrincipal(null)).toBeNull();
    expect(userFromPrincipal("")).toBeNull();
    expect(userFromPrincipal("not base64 json")).toBeNull();
    expect(userFromPrincipal(encode({ userDetails: "" }))).toBeNull();
    expect(userFromPrincipal(encode({ userDetails: 42 }))).toBeNull();
  });
});

describe("requestUser", () => {
  const signedIn = encode({ userDetails: "someone" });

  it("acts as the configured demo user for every request in demo mode", () => {
    expect(requestUser(null, "presenter")).toEqual({ userId: "presenter" });
    expect(requestUser(signedIn, "presenter")).toEqual({ userId: "presenter" });
  });

  it("uses the signed-in principal when demo mode is off", () => {
    expect(requestUser(signedIn, undefined)).toEqual({ userId: "someone" });
    expect(requestUser(signedIn, "")).toEqual({ userId: "someone" });
    expect(requestUser(null, undefined)).toBeNull();
  });
});
