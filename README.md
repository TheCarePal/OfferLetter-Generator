# CarePal Offer Letter Creator

Create offer letters for **Carepalz Internet Private Limited**, using the same left-hand editor and PDF-preview workflow as the CarePal Invoice Generator. The offer letter follows the supplied company sample, including its employment terms, employee acceptance and compensation annexure.

## Features

- Editable employee name, contact details, role, joining date, reporting manager and work location
- Editable salary components, deductions, retention bonus and project incentives
- Calculated monthly and annual compensation totals
- Configurable training, probation, notice period, company signatory and other employment details
- Live PDF preview and PDF download
- Drafts saved in the current browser
- Shared previous offers in Firebase, with the exact saved PDF and form snapshot
- Staff sign-in using the existing approved CarePal accounts
- Responsive layouts for desktop and mobile
- Static export ready for GitHub Pages

PDF generation runs in the browser. Unfinished drafts stay in local browser storage. **Save & download PDF** signs staff in, saves the exact PDF to Cloud Storage and its form snapshot to Firestore, verifies the saved bytes, then downloads them. **Previous offers** loads the shared history across devices. Staff can preview/download the original PDF, load its saved fields, or reuse its terms for a new employee. Saved entries are immutable.

The apps use the existing `the-carepal` Firebase project. Only `sandeep@thecarepal.com` and `admin@thecarepal.com` can access shared history, using their existing Firebase Authentication passwords. Public Firebase Web App identifiers are included in the client; no private keys or passwords are bundled. See [Firebase setup and security rules](FIREBASE_SETUP.md).

Clearing browser storage removes the unfinished local draft, while Firebase history remains available. Earlier browser-only offer records are not automatically uploaded because they do not contain the original PDF bytes. Print/open-preview actions remain available for the current generated PDF; use **Save & download PDF** to archive it.

## Run locally

Use Node.js 22 or newer with Corepack and pnpm:

```bash
corepack enable
corepack install
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>.

The package manager is pinned to pnpm 10.33.4. npm can also run the development and build scripts after dependencies have been installed:

```bash
npm run dev
npm run build
```

## Verify and build

```bash
pnpm type-check
pnpm test
pnpm build
```

The deployable static site is written to `out/`. There is no Node.js server in production.

## Deploy to GitHub Pages

The included `.github/workflows/deploy-pages.yml` checks, builds and deploys on pushes to `main`, and can also be run manually.

1. Create a GitHub repository and push this project to its `main` branch.
2. Open the repository's **Settings → Pages**.
3. Set **Build and deployment → Source** to **GitHub Actions**.
4. Run **Deploy CarePal Offer Letter Creator to GitHub Pages** from the **Actions** tab, or push a change to `main`.

The workflow reads GitHub Pages' base path automatically. Assets and the PDF viewer therefore work at either a root domain or a project URL such as `https://username.github.io/TheCarepal-OfferLetter-Creator/`.

For a manual project-path build:

```bash
NEXT_PUBLIC_BASE_PATH=/TheCarepal-OfferLetter-Creator pnpm build
```

A GitHub repository and live deployment are not created by the local project setup.

## Template and compensation

The template preserves the sample's twelve employment clauses and salary annexure. Employee-specific details are editable. The original sample contains conflicting compensation totals and retention-bonus values; this app calculates totals from the selected components and uses one retention amount and payment period throughout the document.

Monthly gross salary is the sum of basic pay, HRA, statutory bonus, special allowance and LTA. Employer contributions increase company cost. Employee contributions and professional tax reduce net pay before income tax. Annual amounts use twelve months, while project incentives use the configured weekly amount and number of eligible weeks.

Company identity and the default signatory remain specific to TheCarePal. The sample employee's handwritten signature and personal details are not embedded in generated offers.

## Attribution and license

Derived from the CarePal Invoice Generator project, retaining its AGPL-3.0 license and original attribution. See [LICENSE](LICENSE).
