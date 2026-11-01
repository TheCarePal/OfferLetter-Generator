"use client";

import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseClient } from "./client";

export const CAREPAL_STAFF_ACCOUNTS = Object.freeze({
  "sandeep@thecarepal.com": {
    email: "sandeep@thecarepal.com",
    displayName: "Sandeep",
  },
  "admin@thecarepal.com": {
    email: "admin@thecarepal.com",
    displayName: "CarePal Admin",
  },
});
export type StaffProfile = { uid: string; email: string; displayName: string };
export type StaffAuthStatus =
  | "loading"
  | "signed-out"
  | "authorized"
  | "unauthorized"
  | "error";
export type StaffAuthState = {
  status: StaffAuthStatus;
  staff: StaffProfile | null;
  error: string | null;
};

export function getStaffProfile(
  user: Pick<User, "uid" | "email" | "displayName"> | null,
): StaffProfile | null {
  if (!user || !user.uid) return null;
  // Firebase Authentication supplies the trusted account email. A recreated
  // approved account receives a new UID, which remains the archive audit ID.
  const email = user.email?.trim().toLowerCase();
  const account = email
    ? CAREPAL_STAFF_ACCOUNTS[email as keyof typeof CAREPAL_STAFF_ACCOUNTS]
    : undefined;
  if (!account) return null;
  return {
    uid: user.uid,
    email: account.email,
    displayName: user.displayName?.trim().slice(0, 160) || account.displayName,
  };
}

export async function requireStaff(): Promise<StaffProfile> {
  const client = getFirebaseClient();
  await client.persistenceReady;
  await client.auth.authStateReady();
  const staff = getStaffProfile(client.auth.currentUser);
  if (!staff)
    throw new Error(
      "Sign in with an approved CarePal account to use shared history.",
    );
  return staff;
}

export async function signInStaff(
  email: string,
  password: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (
    !Object.values(CAREPAL_STAFF_ACCOUNTS).some(
      (account) => account.email === normalized,
    )
  ) {
    throw new Error("Use sandeep@thecarepal.com or admin@thecarepal.com.");
  }
  const client = getFirebaseClient();
  await client.persistenceReady;
  const result = await signInWithEmailAndPassword(
    client.auth,
    normalized,
    password,
  );
  if (!getStaffProfile(result.user)) {
    await firebaseSignOut(client.auth);
    throw new Error("This account is not approved for shared CarePal history.");
  }
}

export async function signOutStaff(): Promise<void> {
  const client = getFirebaseClient();
  await client.persistenceReady;
  await firebaseSignOut(client.auth);
}

export async function sendStaffPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (
    !Object.values(CAREPAL_STAFF_ACCOUNTS).some(
      (account) => account.email === normalized,
    )
  ) {
    throw new Error("Enter one of the approved CarePal email addresses.");
  }
  const client = getFirebaseClient();
  await client.persistenceReady;
  await sendPasswordResetEmail(client.auth, normalized);
}

export function useStaffAuth() {
  const [state, setState] = useState<StaffAuthState>({
    status: "loading",
    staff: null,
    error: null,
  });
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void Promise.resolve()
      .then(async () => {
        const client = getFirebaseClient();
        await client.persistenceReady;
        if (!active) return;
        unsubscribe = onAuthStateChanged(
          client.auth,
          (user) => {
            if (!active) return;
            const staff = getStaffProfile(user);
            setState({
              status: !user
                ? "signed-out"
                : staff
                  ? "authorized"
                  : "unauthorized",
              staff,
              error:
                user && !staff
                  ? "This account is not approved for shared CarePal history."
                  : null,
            });
          },
          (error) => {
            if (active)
              setState({ status: "error", staff: null, error: error.message });
          },
        );
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            status: "error",
            staff: null,
            error:
              error instanceof Error
                ? error.message
                : "Unable to initialize sign-in.",
          });
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  return {
    ...state,
    signIn: signInStaff,
    signOut: signOutStaff,
    sendPasswordReset: sendStaffPasswordReset,
  };
}

/** Short user-facing messages; backend diagnostics never expose credentials. */
export function getStaffAuthErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "The email or password is incorrect.";
    case "auth/invalid-email":
      return "Enter a valid CarePal email address.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Unable to connect. Check your internet connection and try again.";
    case "auth/user-disabled":
      return "This account is disabled. Contact the CarePal administrator.";
    case "auth/operation-not-allowed":
      return "Email and password sign-in is not enabled for this Firebase project.";
    case "auth/unauthorized-domain":
      return "This website is not authorized for Firebase sign-in. Contact the CarePal administrator.";
    case "auth/web-storage-unsupported":
      return "This browser cannot keep a sign-in session. Enable browser storage and try again.";
    default:
      return error instanceof Error && !code
        ? error.message
        : "Unable to sign in. Please try again.";
  }
}
