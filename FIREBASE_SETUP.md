# Shared CarePal document history

The offer-letter and agreement apps use the existing **the-carepal** Firebase project and **the-carepal.firebasestorage.app** bucket. Both apps share Firebase Authentication accounts with the invoice generator. An app sign-in is separate from the administrator's Firebase CLI login.

## Access and data

Only the same two approved Firebase Authentication email addresses used by the current production invoice rules can read or create document history:

- `sandeep@thecarepal.com`
- `admin@thecarepal.com`

Authorization follows Firebase's signed email claim, while audit fields record the user's current UID. Production changed from fixed UIDs after an administrator account was recreated. Email verification is not newly required: the existing administrator account is unverified, and the deployed invoice policy intentionally permits it. A recreated approved account therefore continues to work; an unrelated email using a former UID does not gain access.

Firestore records live at `organizations/carepal/documentArchives/{kind}/records/{id}`. PDFs live at `document-archives/{kind}/{id}.pdf`. The only supported kinds are `offers` and `agreements`. Approved operators share access to the organization's history; records are not limited to their original author.

Each record stores the validated form snapshot, filename, subject, document date, server save timestamp, saving operator, snapshot/PDF SHA-256 hashes, PDF size/path and schema version. The deterministic record ID hashes the kind and both hashes. Retrying the exact same snapshot and PDF resolves to the same record. The app verifies hashes before reusing saved PDFs or templates. A record's `createdByUid` identifies the operator who finalized its history entry. Storage metadata identifies the operator who uploaded the bytes; these can differ if another approved operator finishes an interrupted save.

The rules validate the record field allowlist, basic types, paths, lowercase hash format, actor and server timestamp. Both records and PDFs are immutable: clients cannot overwrite or delete saved entries. PDFs must be `application/pdf`, at least five bytes and no larger than 20 MiB. Rules cannot calculate SHA-256 or validate the complete nested form schema; the app performs those checks. Firebase's normal document-size limit remains in force.

The archive namespace is excluded from the existing broad organization Firestore grant and public Storage fallback. Existing CareVibes, CRM care-provider, invoice-release and member-portal rules are preserved. Existing invoice and legacy organization Storage prefixes remain private and immutable; unrelated public Storage folders keep their existing behavior.

## Production rollout status

The shared Firestore and Storage rules were deployed to project `the-carepal` on **1 November 2026** and read back through the Firebase Rules API. Both deployed sources exactly match this repository's reviewed rule files. Signed-out requests to synthetic offer and agreement document/PDF paths returned **403** for both services. No production document data, Authentication accounts, indexes or bucket CORS settings were changed by this deployment.

The rules were rebased on the actual production sources, which differ substantially from the invoice repository's older local files. Preservation checks confirmed that existing CareVibes, CRM care-provider and invoice-release policy blocks, along with staff/member invoice PDF policies, remained unchanged. Only the private document-archive rules and exclusions were added. Production deployment is a separate step from a successful build or GitHub Pages publication. Re-read the deployed sources before future changes and preserve unrelated rules.

1. Sign in with an administrator account that can manage Firebase Rules and the Storage bucket:

   ```sh
   corepack pnpm dlx firebase-tools@15.28.1 login
   corepack pnpm dlx firebase-tools@15.28.1 projects:list
   ```

2. Read the currently deployed Firestore and Storage rules in the Firebase console, or retrieve their releases and ruleset sources through the [Firebase Rules API](https://firebase.google.com/docs/reference/rules/rest). Compare them with this repository. Retain unrelated production rules, and make sure their recursive allow rules exclude the new archive namespace. A more specific denial does not override a broad matching allow.

3. Run the emulator suite, then deploy only the reviewed rules from the offer-letter repository:

   ```sh
   node scripts/test-firebase-rules.mjs
   corepack pnpm dlx firebase-tools@15.28.1 deploy --project the-carepal --only firestore:rules,storage
   ```

   This repository is the deployment source for both apps' shared rules. Do not deploy an older copy of the invoice repository's broad rules afterward: that would restore public access to new PDFs and remove archive immutability. Re-read the deployed releases and compare their source to the reviewed local files after deployment. Firebase notes that rule releases can take several minutes to propagate.

4. Check an authenticated PDF download in the browser before changing CORS. The production bucket currently has no explicit bucket CORS entries, but its Firebase download endpoint accepts preflight requests from `https://thecarepal.github.io` with Authorization headers. No bucket configuration change is needed if the download succeeds. [Firebase's download guide](https://firebase.google.com/docs/storage/web/download-files#cors_configuration) describes CORS setup when direct downloads require it. If a browser reports a CORS failure, inspect the current configuration and merge the entries in `storage.cors.json` instead of replacing unrelated origins. GitHub Pages uses origin `https://thecarepal.github.io` for both apps; repository paths are not part of an origin. Add a custom domain if either app later uses one.

   ```sh
   gcloud storage buckets describe gs://the-carepal.firebasestorage.app --format=json
   # After merging with the current configuration:
   gcloud storage buckets update gs://the-carepal.firebasestorage.app --cors-file=merged-cors.json
   ```

5. Sign in to each app with an approved existing account, save a new document, refresh or sign in from another browser, and verify shared history, PDF download and template reuse. Also confirm a signed-out browser and a non-approved account cannot read an archive object through the authenticated Storage endpoint.

The apps use authenticated Storage downloads and create local blob URLs. They do not create or persist Firebase token download URLs. Firebase may maintain download tokens as reserved object metadata; a user who receives a valid token URL may be able to use it independently of a Firebase session. Do not publish token URLs for these documents. Administrators can revoke existing tokens in Storage when necessary.

## Local security checks

Java 21 or newer, Node and Corepack are needed. Run from this repository:

```sh
node scripts/test-firebase-rules.mjs
```

The script uses the pinned Firebase CLI 15.28.1, starts only Firestore/Storage emulators against the **demo-carepal-document-archives** project, and runs `tests/firebase/archive-rules.test.ts`. It never connects these tests to the production database. Ports are 8080 and 9199. A local CLI entrypoint may be provided with `FIREBASE_CLI_PATH` for offline execution. Ordinary unit tests skip this suite unless `FIREBASE_RULES_TESTS=true`.

The suite covers both approved email addresses and document kinds, signed-out/unapproved-email rejection, recreated approved accounts, immutable records and objects, mismatched identity/path/hash/type fields, missing/extra fields, invalid nested prefixes, exact PDF size boundaries, list restrictions and preservation of existing invoice/CareVibes/CRM/member-release behavior. Test cleanup recursively removes nested Storage prefixes because the SDK's root-only `clearStorage()` does not remove nested objects.

For app development against emulators, set `NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true` in `.env.local` and start the Authentication emulator on 9099 as well. Emulator routing is disabled in production builds. Use test identities only; do not copy production passwords or service-account credentials into this repository or GitHub Pages variables.
