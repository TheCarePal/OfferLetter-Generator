"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { z } from "zod";
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  History,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  RefreshCw,
  X,
} from "lucide-react";
import { useStaffAuth } from "@/lib/firebase/auth";
import {
  archiveDocument,
  getArchivedPdf,
  loadArchivePage,
  validateArchivedSnapshot,
  type ArchiveCursor,
  type ArchiveKind,
  type ArchiveRecord,
} from "@/lib/document-archive";
import "./document-history.css";

export type ArchiveDownloadRequest = {
  blob: Blob;
  snapshot: unknown;
  filename: string;
  label: string;
  subtitle?: string;
  documentDate: string;
};

export type ArchiveDownloadResult =
  | { status: "saved"; blob: Blob; record: ArchiveRecord }
  | { status: "sign-in-required" };

type HistoryOptions = {
  kind: ArchiveKind;
  schema: z.ZodTypeAny;
  onLoad: (snapshot: unknown) => void;
  onReuse?: (snapshot: unknown) => void;
};

type Preview = {
  record: ArchiveRecord;
  blob: Blob;
  url: string;
};

/** Preserve useful service errors while translating common authentication failures. */
export function documentHistoryError(error: unknown, fallback: string): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (
    [
      "auth/invalid-credential",
      "auth/wrong-password",
      "auth/user-not-found",
      "auth/invalid-login-credentials",
    ].includes(code)
  ) {
    return "The email or password is incorrect. Check your details and try again.";
  }
  if (code === "auth/too-many-requests")
    return "Too many attempts. Please wait a few minutes before trying again.";
  if (
    code === "auth/network-request-failed" ||
    code === "unavailable" ||
    code === "storage/retry-limit-exceeded"
  ) {
    return "The connection failed. Check your internet connection and try again.";
  }
  if (code === "auth/user-disabled")
    return "This account has been disabled. Contact your CarePal administrator.";
  if (code === "permission-denied" || code === "storage/unauthorized") {
    return "Your account does not have access to shared history. Sign in with an approved CarePal account.";
  }
  if (code === "auth/operation-not-allowed")
    return "Email and password sign-in is not enabled. Contact your CarePal administrator.";
  if (error instanceof Error && error.name === "ZodError")
    return "The saved document is not compatible with this version of the generator.";
  if (
    error instanceof Error &&
    error.message &&
    !error.message.startsWith("Firebase:")
  )
    return error.message;
  return fallback;
}

const displayDate = (value: string, includeTime = false) => {
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value,
  );
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
};

function subtitleOf(record: ArchiveRecord): string {
  if (!record.data || typeof record.data !== "object") return "";
  const data = record.data as Record<string, unknown>;
  const value = record.kind === "offers" ? data.role : data.serviceType;
  return typeof value === "string" ? value : "";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Shared staff sign-in, immutable history browsing and exact archived-PDF retrieval. */
export function useDocumentHistory({
  kind,
  schema,
  onLoad,
  onReuse,
}: HistoryOptions) {
  const auth = useStaffAuth();
  const singular = kind === "offers" ? "offer" : "agreement";
  const plural = kind === "offers" ? "offers" : "agreements";
  const emailId = useId();
  const passwordId = useId();
  const feedbackId = useId();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const [dialog, setDialog] = useState<"sign-in" | "history" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [authAction, setAuthAction] = useState<
    "sign-in" | "reset" | "sign-out" | null
  >(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [records, setRecords] = useState<ArchiveRecord[]>([]);
  const [cursor, setCursor] = useState<ArchiveCursor | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<"load" | "reuse" | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const archiveInFlight = useRef(false);
  const listRequest = useRef(0);
  const pdfRequest = useRef(0);
  const previewUrl = useRef<string | null>(null);
  const afterSignIn = useRef<"history" | "download" | null>(null);
  const currentUid = useRef<string | null>(auth.staff?.uid ?? null);
  currentUid.current = auth.staff?.uid ?? null;

  const clearPreview = useCallback(() => {
    pdfRequest.current += 1;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
    setPdfError(null);
    setPdfLoadingId(null);
    setReplacement(null);
  }, []);

  const closeDialog = useCallback(() => {
    if (archiveInFlight.current || authAction) return;
    listRequest.current += 1;
    setListLoading(false);
    clearPreview();
    setPassword("");
    setPasswordVisible(false);
    setAuthError(null);
    setResetMessage(null);
    setDialog(null);
    afterSignIn.current = null;
  }, [authAction, clearPreview]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listRequest.current += 1;
      pdfRequest.current += 1;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (dialog && !element.open) element.showModal();
    if (!dialog && element.open) element.close();
  }, [dialog]);

  useEffect(() => {
    if (auth.status === "authorized" && dialog === "sign-in") {
      setPassword("");
      setPasswordVisible(false);
      setAuthError(null);
      setResetMessage(null);
      const destination = afterSignIn.current;
      afterSignIn.current = null;
      setDialog(destination === "history" ? "history" : null);
    }
    if (auth.status !== "authorized") {
      listRequest.current += 1;
      setRecords([]);
      setCursor(null);
      setListLoading(false);
      clearPreview();
      if (dialog === "history") {
        afterSignIn.current = "history";
        setDialog("sign-in");
      }
    }
  }, [auth.status, dialog, clearPreview]);

  const fetchPage = useCallback(
    async (after: ArchiveCursor | null = null) => {
      if (auth.status !== "authorized") return;
      const request = ++listRequest.current;
      const uid = currentUid.current;
      setListLoading(true);
      setListError(null);
      try {
        const page = await loadArchivePage(kind, after);
        if (
          !mounted.current ||
          request !== listRequest.current ||
          currentUid.current !== uid
        )
          return;
        setRecords((current) => {
          const base = after ? current : [];
          const ids = new Set(base.map((record) => record.id));
          return [
            ...base,
            ...page.records.filter((record) => !ids.has(record.id)),
          ];
        });
        setCursor(page.nextCursor);
      } catch (error) {
        if (mounted.current && request === listRequest.current)
          setListError(
            documentHistoryError(
              error,
              `Couldn’t load previous ${plural}. Please try again.`,
            ),
          );
      } finally {
        if (mounted.current && request === listRequest.current)
          setListLoading(false);
      }
    },
    [auth.status, kind, plural],
  );

  useEffect(() => {
    if (dialog === "history" && auth.status === "authorized") void fetchPage();
  }, [dialog, auth.status, fetchPage]);

  const requestSignIn = useCallback(() => {
    if (archiveInFlight.current || authAction) return;
    afterSignIn.current = "download";
    setAuthError(null);
    setResetMessage(null);
    setPassword("");
    setPasswordVisible(false);
    setEmail(auth.staff?.email ?? "");
    setDialog("sign-in");
  }, [authAction, auth.staff?.email]);

  const openHistory = useCallback(() => {
    if (archiveInFlight.current || authAction) return;
    setSearch("");
    setListError(null);
    clearPreview();
    if (auth.status === "authorized") setDialog("history");
    else {
      requestSignIn();
      afterSignIn.current = "history";
    }
  }, [auth.status, authAction, clearPreview, requestSignIn]);

  const archiveDownload = useCallback(
    async (request: ArchiveDownloadRequest): Promise<ArchiveDownloadResult> => {
      if (auth.status !== "authorized" || !auth.staff) {
        requestSignIn();
        return { status: "sign-in-required" };
      }
      if (archiveInFlight.current)
        throw new Error(
          `This ${singular} is already being saved. Please wait.`,
        );
      archiveInFlight.current = true;
      setArchiveBusy(true);
      const uid = auth.staff.uid;
      try {
        const record = await archiveDocument({
          kind,
          data: request.snapshot,
          pdf: request.blob,
          filename: request.filename,
          subjectName: request.label,
          documentDate: request.documentDate,
          schema,
        });
        const blob = await getArchivedPdf(record);
        if (!mounted.current || currentUid.current !== uid)
          throw new Error(
            "Your sign-in session changed. Sign in again before downloading this document.",
          );
        return { status: "saved", blob, record };
      } finally {
        archiveInFlight.current = false;
        if (mounted.current) setArchiveBusy(false);
      }
    },
    [auth.staff, auth.status, kind, requestSignIn, schema, singular],
  );

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authAction) return;
    setAuthError(null);
    setResetMessage(null);
    setAuthAction("sign-in");
    try {
      await auth.signIn(email.trim(), password);
      setPassword("");
    } catch (error) {
      setAuthError(
        documentHistoryError(
          error,
          "Couldn’t sign in. Check your email and password and try again.",
        ),
      );
    } finally {
      if (mounted.current) setAuthAction(null);
    }
  };

  const resetPassword = async () => {
    if (authAction || !emailRef.current?.reportValidity()) return;
    setAuthError(null);
    setResetMessage(null);
    setAuthAction("reset");
    try {
      await auth.sendPasswordReset(email.trim());
      setResetMessage(
        "If this approved account exists, a password reset link has been sent to its email address.",
      );
    } catch (error) {
      setAuthError(
        documentHistoryError(
          error,
          "Couldn’t send a reset email. Please try again.",
        ),
      );
    } finally {
      if (mounted.current) setAuthAction(null);
    }
  };

  const signOut = async () => {
    if (archiveInFlight.current || authAction) return;
    setAuthAction("sign-out");
    setAuthError(null);
    try {
      await auth.signOut();
      clearPreview();
      setRecords([]);
      setCursor(null);
      setDialog(null);
    } catch (error) {
      setAuthError(
        documentHistoryError(error, "Couldn’t sign out. Please try again."),
      );
    } finally {
      if (mounted.current) setAuthAction(null);
    }
  };

  const selectRecord = async (record: ArchiveRecord) => {
    const request = ++pdfRequest.current;
    const uid = currentUid.current;
    setPdfError(null);
    setPdfLoadingId(record.id);
    setReplacement(null);
    try {
      const blob = await getArchivedPdf(record);
      if (
        !mounted.current ||
        request !== pdfRequest.current ||
        currentUid.current !== uid
      )
        return;
      const url = URL.createObjectURL(blob);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = url;
      setPreview({ record, blob, url });
    } catch (error) {
      if (mounted.current && request === pdfRequest.current)
        setPdfError(
          documentHistoryError(
            error,
            "Couldn’t load the archived PDF. Please try again.",
          ),
        );
    } finally {
      if (mounted.current && request === pdfRequest.current)
        setPdfLoadingId(null);
    }
  };

  const replaceDraft = () => {
    if (!preview || !replacement) return;
    try {
      const snapshot = validateArchivedSnapshot(preview.record, schema);
      (replacement === "reuse" ? onReuse : onLoad)?.(snapshot);
      setReplacement(null);
      closeDialog();
    } catch (error) {
      setPdfError(
        documentHistoryError(
          error,
          "The saved document cannot be loaded into this version of the generator.",
        ),
      );
      setReplacement(null);
    }
  };

  const busy = archiveBusy || !!authAction || listLoading || !!pdfLoadingId;
  const visibleAuthError =
    authError ??
    (auth.status === "unauthorized" || auth.status === "error"
      ? auth.error
      : null);
  const filtered = records.filter((record) =>
    `${record.subjectName} ${subtitleOf(record)} ${record.documentDate}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  const sessionActions = (
    <div className="document-session" aria-busy={!!authAction || archiveBusy}>
      {auth.status === "authorized" ? (
        <>
          <span className="document-session-name" title={auth.staff?.email}>
            <Check size={13} aria-hidden="true" />
            {auth.staff?.displayName}
          </span>
          <button
            className="button button-outline button-small"
            type="button"
            disabled={archiveBusy || !!authAction}
            onClick={() => void signOut()}
          >
            {authAction === "sign-out" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <LogOut size={15} />
            )}
            {authAction === "sign-out" ? "Signing out…" : "Sign out"}
          </button>
        </>
      ) : (
        <>
          <button
            className="button button-outline button-small"
            type="button"
            onClick={requestSignIn}
            disabled={auth.status === "loading" || archiveBusy || !!authAction}
          >
            {auth.status === "loading" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <LogIn size={15} />
            )}
            {auth.status === "loading" ? "Connecting…" : "Staff sign in"}
          </button>
          {auth.status === "unauthorized" && (
            <button
              className="button button-outline button-small"
              type="button"
              disabled={archiveBusy || !!authAction}
              onClick={() => void signOut()}
            >
              <LogOut size={15} />
              Sign out
            </button>
          )}
        </>
      )}
      {visibleAuthError && dialog !== "sign-in" && (
        <span role="alert" className="document-session-error">
          {visibleAuthError}
        </span>
      )}
    </div>
  );

  const dialogs = (
    <dialog
      ref={dialogRef}
      className={`modal document-history-modal ${dialog === "history" ? "document-history-wide" : ""}`}
      aria-labelledby={dialogTitleId}
      aria-describedby={dialogDescriptionId}
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <div className="modal-header">
        <h2 id={dialogTitleId}>
          {dialog === "sign-in"
            ? "CarePal staff sign in"
            : preview
              ? preview.record.subjectName
              : `Previous ${plural}`}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          disabled={archiveBusy || !!authAction}
          onClick={closeDialog}
        >
          <X size={20} />
        </button>
      </div>
      {dialog === "sign-in" ? (
        <>
          <div className="document-sign-in-icon">
            <LockKeyhole size={22} aria-hidden="true" />
          </div>
          <p id={dialogDescriptionId} className="modal-description">
            Sign in with an approved CarePal account to save and access shared{" "}
            {plural}. After signing in, press{" "}
            <strong>Save & download PDF</strong> again to save the current
            document.
          </p>
          <form
            className="document-sign-in-form"
            onSubmit={(event) => void signIn(event)}
            aria-busy={!!authAction}
          >
            <div className="field">
              <label htmlFor={emailId}>Email address</label>
              <input
                ref={emailRef}
                id={emailId}
                name="email"
                type="email"
                value={email}
                autoComplete="username"
                inputMode="email"
                required
                autoFocus
                disabled={!!authAction}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby={feedbackId}
              />
            </div>
            <div className="field">
              <div className="document-password-heading">
                <label htmlFor={passwordId}>Password</label>
                <button
                  type="button"
                  className="text-button"
                  disabled={!!authAction}
                  onClick={() => void resetPassword()}
                >
                  {authAction === "reset"
                    ? "Sending reset link…"
                    : "Forgot password?"}
                </button>
              </div>
              <div className="document-password-input">
                <input
                  id={passwordId}
                  name="password"
                  type={passwordVisible ? "text" : "password"}
                  value={password}
                  autoComplete="current-password"
                  required
                  disabled={!!authAction}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={feedbackId}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={
                    passwordVisible ? "Hide password" : "Show password"
                  }
                  disabled={!!authAction}
                  onClick={() => setPasswordVisible((value) => !value)}
                >
                  {passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            <div
              id={feedbackId}
              className="document-auth-feedback"
              aria-live="polite"
              aria-atomic="true"
            >
              {visibleAuthError ? (
                <p role="alert" className="field-error">
                  {visibleAuthError}
                </p>
              ) : resetMessage ? (
                <p className="document-success">{resetMessage}</p>
              ) : null}
            </div>
            <div className="confirmation-actions">
              <button
                type="button"
                className="button button-outline"
                disabled={!!authAction}
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={!!authAction || auth.status === "loading"}
              >
                {authAction === "sign-in" && (
                  <LoaderCircle className="spin" size={16} />
                )}
                {authAction === "sign-in" ? "Signing in…" : "Sign in"}
              </button>
            </div>
          </form>
          <p className="document-access-note">
            Access is limited to approved CarePal staff accounts. Your current
            draft stays in this browser.
          </p>
        </>
      ) : (
        <>
          <p id={dialogDescriptionId} className="modal-description">
            {preview
              ? `This is the exact PDF stored in shared history, verified before opening. Saved ${displayDate(preview.record.savedAt, true)} by ${preview.record.createdByName}.`
              : `Browse ${plural} saved by CarePal staff. Saved PDFs remain unchanged when their details are reused.`}
          </p>
          {preview ? (
            <>
              <div className="document-preview-actions">
                <button
                  className="button button-outline button-small"
                  type="button"
                  onClick={clearPreview}
                >
                  <ArrowLeft size={15} />
                  Back to history
                </button>
                <a
                  className="button button-outline button-small"
                  href={preview.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={15} />
                  Open PDF
                </a>
                <button
                  className="button button-primary button-small"
                  type="button"
                  onClick={() =>
                    downloadBlob(preview.blob, preview.record.filename)
                  }
                >
                  <Download size={15} />
                  Download saved PDF
                </button>
              </div>
              <iframe
                className="document-archive-preview"
                src={preview.url}
                title={`Archived ${singular}: ${preview.record.filename}`}
              />
              <div className="document-archive-details">
                <span>{preview.record.filename}</span>
                <span>
                  {Math.max(1, Math.round(preview.record.pdfSizeBytes / 1024))}{" "}
                  KB · saved PDF
                </span>
              </div>
              {pdfError && (
                <p className="field-error" role="alert">
                  {pdfError}
                </p>
              )}
              {replacement ? (
                <div
                  className="document-replacement"
                  role="group"
                  aria-label="Confirm draft replacement"
                >
                  <strong>
                    {replacement === "reuse"
                      ? `Reuse this ${singular}'s terms?`
                      : `Load this ${singular} into the editor?`}
                  </strong>
                  <p>
                    This replaces the current browser draft. The archived PDF
                    stays unchanged.{" "}
                    {replacement === "reuse"
                      ? "Personal details will be cleared for the new document."
                      : "Download the current draft first if you need to keep it."}
                  </p>
                  <div className="confirmation-actions">
                    <button
                      type="button"
                      className="button button-outline button-small"
                      onClick={() => setReplacement(null)}
                    >
                      Keep current draft
                    </button>
                    <button
                      type="button"
                      className="button button-primary button-small"
                      onClick={replaceDraft}
                    >
                      {replacement === "reuse"
                        ? "Reuse terms"
                        : `Load ${singular}`}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="document-template-actions">
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() => setReplacement("load")}
                  >
                    Load saved details
                  </button>
                  {onReuse && (
                    <button
                      type="button"
                      className="button button-outline"
                      onClick={() => setReplacement("reuse")}
                    >
                      Reuse terms for a new {singular}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="document-history-filter">
                <input
                  className="history-search"
                  aria-label={`Search loaded ${plural}`}
                  placeholder="Search loaded names, roles or dates…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button
                  className="button button-outline button-small"
                  type="button"
                  disabled={listLoading}
                  onClick={() => void fetchPage()}
                >
                  <RefreshCw className={listLoading ? "spin" : ""} size={15} />
                  Refresh
                </button>
              </div>
              {listError && (
                <div className="document-history-alert" role="alert">
                  <p>{listError}</p>
                  <button
                    className="button button-outline button-small"
                    type="button"
                    disabled={listLoading}
                    onClick={() =>
                      void fetchPage(cursor && records.length ? cursor : null)
                    }
                  >
                    Try again
                  </button>
                </div>
              )}
              {pdfError && (
                <p className="field-error" role="alert">
                  {pdfError}
                </p>
              )}
              <div
                className="document-history-list"
                aria-busy={listLoading || !!pdfLoadingId}
              >
                {listLoading && !records.length ? (
                  <div className="empty-history" role="status">
                    <LoaderCircle className="spin" size={25} />
                    <p>Loading previous {plural}…</p>
                  </div>
                ) : filtered.length ? (
                  filtered.map((record) => (
                    <article
                      className="document-history-record"
                      key={record.id}
                    >
                      <div className="history-file-icon">
                        <FileText size={21} aria-hidden="true" />
                      </div>
                      <div className="document-record-info">
                        <h3>{record.subjectName}</h3>
                        <p>{subtitleOf(record)}</p>
                        <span>
                          {displayDate(record.documentDate)} · saved{" "}
                          {displayDate(record.savedAt, true)}
                        </span>
                        <span>By {record.createdByName}</span>
                      </div>
                      <button
                        className="button button-outline button-small"
                        type="button"
                        disabled={!!pdfLoadingId}
                        onClick={() => void selectRecord(record)}
                      >
                        {pdfLoadingId === record.id ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <Eye size={15} />
                        )}
                        {pdfLoadingId === record.id ? "Verifying…" : "View PDF"}
                      </button>
                    </article>
                  ))
                ) : (
                  !listError && (
                    <div className="empty-history">
                      <History size={30} aria-hidden="true" />
                      <strong>
                        {search
                          ? "No matching documents loaded"
                          : `No saved ${plural} yet`}
                      </strong>
                      <p>
                        {search
                          ? "Try another search or load more documents."
                          : `Use Save & download PDF to add your first ${singular} to shared history.`}
                      </p>
                    </div>
                  )
                )}
              </div>
              <div className="document-history-footer">
                <span>
                  {records.length} {records.length === 1 ? singular : plural}{" "}
                  loaded{cursor ? " · more available" : ""}
                </span>
                {cursor && (
                  <button
                    className="button button-outline button-small"
                    type="button"
                    disabled={listLoading || !!pdfLoadingId}
                    onClick={() => void fetchPage(cursor)}
                  >
                    {listLoading ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : null}
                    {listLoading ? "Loading…" : `Load more ${plural}`}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </dialog>
  );

  return {
    archiveDownload,
    openHistory,
    requestSignIn,
    busy,
    archiveBusy,
    sessionActions,
    dialogs,
    isSignedIn: auth.status === "authorized",
    authStatus: auth.status,
  };
}
