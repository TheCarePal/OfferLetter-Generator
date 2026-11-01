import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import "firebase/compat/firestore";
import "firebase/compat/storage";
import firebase from "firebase/compat/app";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const UID = "kra0usqGCfbWW8o3LDlwbFaOdSj2";
const SECOND_UID = "qcEl7bPuFSQ8KO59DjvowWRYfdD3";
const ID = "a".repeat(64);
const SHA = "b".repeat(64);
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const rootPath = (kind = "offers") => `organizations/carepal/documentArchives/${kind}/records`;
const recordPath = (kind = "offers", id = ID) => `${rootPath(kind)}/${id}`;
const pdfPath = (kind = "offers", id = ID) => `document-archives/${kind}/${id}.pdf`;
const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
const record = (kind = "offers", id = ID, uid = UID) => ({
  id, kind, schemaVersion: 1,
  data: kind === "offers" ? { employeeName: "Test Employee" } : { clientName: "Test Client" },
  filename: "CarePal-document.pdf", subjectName: "Test person", documentDate: "2026-11-01",
  savedAt: firebase.firestore.FieldValue.serverTimestamp(), createdByUid: uid, createdByName: "CarePal operator",
  snapshotSha256: SHA, pdfSha256: SHA, pdfSizeBytes: pdfBytes.length, pdfStoragePath: pdfPath(kind, id),
});
const metadata = (kind = "offers", id = ID, uid = UID) => ({
  contentType: "application/pdf",
  customMetadata: { archiveId: id, kind, pdfSha256: SHA, snapshotSha256: SHA, createdByUid: uid },
});
const describeRules = process.env.FIREBASE_RULES_TESTS === "true" ? describe : describe.skip;

describeRules("private immutable CarePal document archives", () => {
  let environment: RulesTestEnvironment;
  const staff = (uid = UID) => environment.authenticatedContext(uid, {
    email: uid === UID ? "sandeep@thecarepal.com" : "admin@thecarepal.com",
  });
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: "demo-carepal-document-archives",
      firestore: { rules: readFileSync(resolve("firestore.rules"), "utf8") },
      storage: { rules: readFileSync(resolve("storage.rules"), "utf8") },
    });
  });
  beforeEach(async () => {
    // rules-unit-testing clearStorage() only deletes root objects. Our archives
    // are nested, so recursively remove prefixes to isolate every test.
    await Promise.all([
      environment.clearFirestore(),
      environment.withSecurityRulesDisabled(async (context) => {
        const removePrefix = async (reference: firebase.storage.Reference): Promise<void> => {
          const listing = await reference.listAll();
          await Promise.all([
            ...listing.items.map((item) => item.delete()),
            ...listing.prefixes.map(removePrefix),
          ]);
        };
        await removePrefix(context.storage().ref());
      }),
    ]);
  });
  afterAll(async () => { await environment?.cleanup(); });

  it.each([
    ["offers", UID, SECOND_UID], ["agreements", UID, SECOND_UID],
    ["offers", SECOND_UID, UID], ["agreements", SECOND_UID, UID],
  ])("allows shared immutable %s created by approved UID %s", async (kind, authorUid, readerUid) => {
    const author = staff(authorUid);
    const reader = staff(readerUid);
    await assertSucceeds(author.firestore().doc(recordPath(kind)).set(record(kind, ID, authorUid)));
    const saved = await assertSucceeds(reader.firestore().doc(recordPath(kind)).get());
    expect(saved.get("createdByUid")).toBe(authorUid);
    await assertSucceeds(reader.firestore().collection(rootPath(kind)).orderBy("savedAt", "desc").limit(21).get());
    const target = author.storage().ref(pdfPath(kind));
    await assertSucceeds(Promise.resolve(target.put(pdfBytes, metadata(kind, ID, authorUid))));
    await assertSucceeds(reader.storage().ref(pdfPath(kind)).getMetadata());
  });

  it.each([null, "another_user"])("denies unauthorised Firestore access for %s", async (uid) => {
    const context = uid ? environment.authenticatedContext(uid, { email: "unapproved@example.com" }) : environment.unauthenticatedContext();
    await assertFails(context.firestore().doc(recordPath()).get());
    await assertFails(context.firestore().collection(rootPath()).get());
    await assertFails(context.firestore().doc(recordPath()).set(record()));
  });

  it("denies updates, overwrites and deletes even from approved accounts", async () => {
    const reference = staff().firestore().doc(recordPath());
    await assertSucceeds(reference.set(record()));
    await assertFails(reference.update({ subjectName: "Changed" }));
    await assertFails(reference.set(record()));
    await assertFails(reference.delete());
  });

  it.each([
    ["mismatched kind", { kind: "agreements" }],
    ["mismatched id", { id: "c".repeat(64) }],
    ["another actor", { createdByUid: SECOND_UID }],
    ["unsafe PDF path", { pdfStoragePath: `document-archives/agreements/${ID}.pdf` }],
    ["external PDF URL", { pdfStoragePath: "https://example.com/private.pdf" }],
    ["traversal filename", { filename: "../CarePal.pdf" }],
    ["backslash filename", { filename: "folder\\CarePal.pdf" }],
    ["control filename", { filename: "bad\nname.pdf" }],
    ["invalid hash", { pdfSha256: "INVALID" }],
    ["oversized PDF", { pdfSizeBytes: MAX_PDF_BYTES + 1 }],
    ["empty PDF", { pdfSizeBytes: 0 }],
    ["noninteger PDF size", { pdfSizeBytes: 5.5 }],
    ["unsupported schema", { schemaVersion: 2 }],
    ["unknown field", { downloadUrl: "https://example.com" }],
    ["bad snapshot type", { data: "not a map" }],
    ["forged time", { savedAt: firebase.firestore.Timestamp.fromMillis(0) }],
  ])("rejects %s in a record", async (_label, patch) => {
    await assertFails(staff().firestore().doc(recordPath()).set({ ...record(), ...patch }));
  });

  it("rejects missing required record fields", async () => {
    const entry = record();
    const { pdfSha256: _hash, ...incomplete } = entry;
    await assertFails(staff().firestore().doc(recordPath()).set(incomplete));
  });

  it.each(["invoices", "../offers", "Offers"])("denies unsupported kind %s and nested namespace escape", async (kind) => {
    const db = staff().firestore();
    await assertFails(db.doc(`organizations/carepal/documentArchives/${kind.replaceAll("/", "-")}/records/${ID}`).set(record()));
    await assertFails(db.doc(`organizations/carepal/documentArchives/offers/records/${ID}/extra/document`).set({ value: true }));
    await assertFails(db.doc("organizations/carepal/documentArchives/offers").set({ value: true }));
  });

  it.each([null, "another_user"])("denies unauthorised PDF reads and writes for %s", async (uid) => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.storage().ref(pdfPath()).put(pdfBytes, metadata());
    });
    const context = uid ? environment.authenticatedContext(uid, { email: "unapproved@example.com" }) : environment.unauthenticatedContext();
    await assertFails(context.storage().ref(pdfPath()).getMetadata());
    await assertFails(Promise.resolve(context.storage().ref(pdfPath("agreements")).put(pdfBytes, metadata("agreements"))));
  });

  it("denies PDF updates, metadata changes, deletes and listing", async () => {
    const storage = staff().storage();
    const target = storage.ref(pdfPath());
    await assertSucceeds(Promise.resolve(target.put(pdfBytes, metadata())));
    await assertFails(Promise.resolve(target.put(pdfBytes, metadata())));
    await assertFails(target.updateMetadata({ customMetadata: { ...metadata().customMetadata, pdfSha256: "c".repeat(64) } }));
    await assertFails(target.delete());
    await assertFails(storage.ref("document-archives/offers").listAll());
  });

  it.each([
    ["wrong content type", { contentType: "text/plain" }],
    ["missing metadata", { customMetadata: {} }],
    ["wrong actor metadata", { customMetadata: { ...metadata().customMetadata, createdByUid: SECOND_UID } }],
    ["wrong kind metadata", { customMetadata: { ...metadata().customMetadata, kind: "agreements" } }],
    ["wrong id metadata", { customMetadata: { ...metadata().customMetadata, archiveId: "c".repeat(64) } }],
    ["invalid hash metadata", { customMetadata: { ...metadata().customMetadata, snapshotSha256: "INVALID" } }],
    ["unrecognised metadata", { customMetadata: { ...metadata().customMetadata, unexpectedField: "value" } }],
  ])("rejects PDF with %s", async (_label, patch) => {
    await assertFails(Promise.resolve(staff().storage().ref(pdfPath()).put(pdfBytes, { ...metadata(), ...patch })));
  });

  it.each([
    "document-archives/private/file.pdf",
    `document-archives/offers/subfolder/${ID}.pdf`,
    "document-archives/offers/invalid.pdf",
    `document-archives/${ID}.pdf`,
    "document-archives",
  ])("reserves the whole private prefix: %s", async (path) => {
    await assertFails(Promise.resolve(environment.unauthenticatedContext().storage().ref(path).put(pdfBytes, metadata())));
    await assertFails(Promise.resolve(staff().storage().ref(path).put(pdfBytes, metadata())));
  });

  it("allows exactly the size cap and rejects a PDF larger than it", async () => {
    const storage = staff().storage();
    await assertSucceeds(Promise.resolve(storage.ref(pdfPath()).put(new Uint8Array(MAX_PDF_BYTES), metadata())));
    const nextId = "c".repeat(64);
    await assertFails(Promise.resolve(storage.ref(pdfPath("offers", nextId)).put(new Uint8Array(MAX_PDF_BYTES + 1), metadata("offers", nextId))));
  }, 60_000);

  it("uses approved email claims when an account is recreated with a new UID", async () => {
    const newUid = "replacement_admin_uid";
    const approved = environment.authenticatedContext(newUid, { email: "admin@thecarepal.com", email_verified: false });
    await assertSucceeds(approved.firestore().doc(recordPath()).set(record("offers", ID, newUid)));
    await assertSucceeds(Promise.resolve(approved.storage().ref(pdfPath()).put(pdfBytes, metadata("offers", ID, newUid))));
    const staleUidWrongEmail = environment.authenticatedContext(UID, { email: "unapproved@example.com" });
    await assertFails(staleUidWrongEmail.firestore().doc(recordPath()).get());
    await assertFails(staleUidWrongEmail.storage().ref(pdfPath()).getMetadata());
  });

  it("keeps existing invoice PDF namespaces private and create-only", async () => {
    const path = "invoices/inv_123/versions/ver_123.pdf";
    const target = staff().storage().ref(path);
    await assertSucceeds(Promise.resolve(target.put(pdfBytes, { contentType: "application/pdf" })));
    await assertSucceeds(target.getMetadata());
    await assertFails(Promise.resolve(target.put(pdfBytes, { contentType: "application/pdf" })));
    await assertFails(target.delete());
    await assertFails(environment.unauthenticatedContext().storage().ref(path).getMetadata());
    await assertFails(Promise.resolve(environment.unauthenticatedContext().storage().ref("organizations/legacy/private.pdf").put(pdfBytes, { contentType: "application/pdf" })));
  });

  it("preserves the CRM care-provider policy", async () => {
    const provider = staff().firestore().doc("careProviders/doctor_123");
    await assertSucceeds(provider.set({ name: "Test Doctor", kind: "doctor", speciality: "General care", mode: "Online", fee: 500, active: true }));
    await assertSucceeds(environment.authenticatedContext("member_uid").firestore().doc(provider.path).get());
    await assertFails(environment.unauthenticatedContext().firestore().doc(provider.path).get());
    await assertFails(environment.authenticatedContext("member_uid").firestore().doc(provider.path).update({ fee: 1 }));
    await assertFails(provider.update({ fee: -1 }));
    await assertFails(provider.delete());
  });

  it("preserves invoice-release recipient checks and immutable release fields", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("organizations/carepal/invoices/inv_123").set({ status: "raised" });
      await context.firestore().doc("organizations/carepal/invoices/inv_123/versions/ver_123").set({
        invoiceData: { buyer: { email: "buyer@example.com" } }, invoiceNumber: "CP-001", buyerName: "Test Buyer", invoiceDate: "2026-11-01", total: 100,
        pdfStoragePath: "invoices/inv_123/versions/ver_123.pdf", pdfSha256: SHA, pdfSizeBytes: pdfBytes.length,
      });
    });
    const releasePath = "invoiceReleases/inv_123__ver_123";
    const release = {
      invoiceId: "inv_123", versionId: "ver_123", memberEmail: "buyer@example.com", invoiceNumber: "CP-001", buyerName: "Test Buyer", invoiceDate: "2026-11-01", total: 100, currency: "INR",
      pdfStoragePath: "invoices/inv_123/versions/ver_123.pdf", pdfSha256: SHA, pdfSizeBytes: pdfBytes.length,
      status: "released", releasedAt: firebase.firestore.FieldValue.serverTimestamp(), releasedByEmail: "sandeep@thecarepal.com", withdrawnAt: null, withdrawnByEmail: null,
    };
    const target = staff().firestore().doc(releasePath);
    await assertFails(target.set({ ...release, memberEmail: "wrong@example.com" }));
    await assertSucceeds(target.set(release));
    const buyer = environment.authenticatedContext("buyer_uid", { email: "buyer@example.com", email_verified: true });
    await assertSucceeds(buyer.firestore().doc(releasePath).get());
    await assertFails(environment.authenticatedContext("another_member", { email: "another@example.com", email_verified: true }).firestore().doc(releasePath).get());
    await assertFails(environment.authenticatedContext("unverified_buyer", { email: "buyer@example.com", email_verified: false }).firestore().doc(releasePath).get());
    await assertFails(target.update({ total: 999 }));
    await assertFails(target.delete());
    await assertSucceeds(target.update({ status: "withdrawn", withdrawnAt: firebase.firestore.FieldValue.serverTimestamp(), withdrawnByEmail: "sandeep@thecarepal.com" }));
    await assertFails(buyer.firestore().doc(releasePath).get());
  });

  it("preserves legacy invoice Firestore permissions", async () => {
    const target = staff().firestore().doc("organizations/carepal/invoices/existing_invoice");
    await assertSucceeds(target.set({ invoiceNumber: "CP-001" }));
    await assertSucceeds(target.update({ invoiceNumber: "CP-002" }));
    await assertSucceeds(target.delete());
    const organization = staff().firestore().doc("organizations/carepal");
    await assertSucceeds(organization.set({ name: "CarePal" }));
    await assertSucceeds(organization.get());
    await assertSucceeds(organization.delete());
    await assertFails(environment.unauthenticatedContext().firestore().doc(target.path).get());
  });

  it("preserves authenticated CareVibes and unrelated public Storage permissions", async () => {
    const post = environment.authenticatedContext("carevibes_user").firestore().doc("root/theCarePal/careVerse/careVibes/posts/post");
    await assertSucceeds(post.set({ body: "existing post" }));
    const comment = post.collection("userInteractions").doc("comments").collection("allComments").doc("comment");
    await assertSucceeds(comment.set({ body: "existing comment" }));
    await assertFails(environment.unauthenticatedContext().firestore().doc(post.path).get());
    await assertFails(environment.unauthenticatedContext().firestore().doc(comment.path).get());
    const existingPublicObject = environment.unauthenticatedContext().storage().ref("profile_images/public-test.png");
    await assertSucceeds(Promise.resolve(existingPublicObject.put(pdfBytes, { contentType: "image/png" })));
    await assertSucceeds(existingPublicObject.getMetadata());
    await assertSucceeds(existingPublicObject.delete());
  });
});
