import { afterEach, describe, expect, it, vi } from "vitest";
import { CAREPAL_STAFF_ACCOUNTS, getStaffProfile } from "../../firebase/auth";
import {
  CAREPAL_FIREBASE_PUBLIC_CONFIG,
  shouldUseFirebaseEmulators,
} from "../../firebase/client";

afterEach(() => vi.unstubAllEnvs());

describe("CarePal document history authentication", () => {
  it("uses the same approved email accounts as the live invoice policy", () => {
    expect(Object.keys(CAREPAL_STAFF_ACCOUNTS)).toEqual([
      "sandeep@thecarepal.com",
      "admin@thecarepal.com",
    ]);
    expect(
      getStaffProfile({
        uid: "current-sandeep-uid",
        email: "sandeep@thecarepal.com",
        displayName: null,
      }),
    ).toMatchObject({
      uid: "current-sandeep-uid",
      email: "sandeep@thecarepal.com",
      displayName: "Sandeep",
    });
  });

  it("accepts a recreated approved account and audits its current Firebase UID", () => {
    expect(
      getStaffProfile({
        uid: "new-admin-uid-after-recreation",
        email: "admin@thecarepal.com",
        displayName: "Admin",
      }),
    ).toEqual({
      uid: "new-admin-uid-after-recreation",
      email: "admin@thecarepal.com",
      displayName: "Admin",
    });
  });

  it("normalizes the authenticated account email", () => {
    expect(
      getStaffProfile({
        uid: "current-admin-uid",
        email: " ADMIN@THECAREPAL.COM ",
        displayName: null,
      }),
    ).toMatchObject({
      uid: "current-admin-uid",
      email: "admin@thecarepal.com",
    });
  });

  it("denies non-approved emails regardless of their UID", () => {
    expect(
      getStaffProfile({
        uid: "XACOQ33m5aSwmnlSLl4CdqPKYJ52",
        email: "someone@example.com",
        displayName: "Admin",
      }),
    ).toBeNull();
    expect(
      getStaffProfile({
        uid: "kra0usqGCfbWW8o3LDlwbFaOdSj2",
        email: "other@thecarepal.com",
        displayName: "Sandeep",
      }),
    ).toBeNull();
    expect(
      getStaffProfile({
        uid: "unknown",
        email: "someone@example.com",
        displayName: null,
      }),
    ).toBeNull();
    expect(
      getStaffProfile({ uid: "current", email: null, displayName: null }),
    ).toBeNull();
    expect(getStaffProfile(null)).toBeNull();
  });

  it("keeps the new Web App in the existing Firebase project", () => {
    expect(CAREPAL_FIREBASE_PUBLIC_CONFIG).toMatchObject({
      projectId: "the-carepal",
      storageBucket: "the-carepal.firebasestorage.app",
    });
  });

  it("uses emulators only after an explicit local opt-in", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_USE_EMULATORS", "");
    expect(shouldUseFirebaseEmulators()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_USE_EMULATORS", "true");
    expect(shouldUseFirebaseEmulators()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(shouldUseFirebaseEmulators()).toBe(false);
  });
});
