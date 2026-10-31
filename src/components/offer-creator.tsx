"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pdf } from "@react-pdf/renderer";
import {
  Download,
  FilePlus2,
  History,
  LoaderCircle,
  Check,
  Pencil,
  FileText,
  X,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { createOfferDefaults, offerSchema, type OfferData } from "@/lib/offer";
import {
  DRAFT_KEY,
  HISTORY_KEY,
  readDraft,
  readHistory,
  recordDownload,
  offerFilename,
  type OfferRecord,
} from "@/lib/offer-storage";
import { getPublicAssetPath } from "@/lib/public-path";
import { OfferDocument } from "./offer-document";
import { OfferForm, type FormErrors } from "./offer-form";
import PdfPreview from "./pdf-preview";

type GeneratedPdf = { key: string; blob: Blob; url: string };
type Dialog = "history" | "new" | "clear-history" | null;

const SHOW_PREVIOUS_OFFERS = false;

export default function OfferCreator() {
  const [data, setData] = useState<OfferData | null>(null);
  const [saved, setSaved] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [generated, setGenerated] = useState<GeneratedPdf | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [errors, setErrors] = useState<FormErrors>({});
  const [dialog, setDialog] = useState<Dialog>(null);
  const [records, setRecords] = useState<OfferRecord[]>([]);
  const [search, setSearch] = useState("");
  const [mobileTab, setMobileTab] = useState("edit");
  const latestRequest = useRef<{ data: OfferData; key: string } | null>(null);
  const rendering = useRef(false);
  const active = useRef(true);
  const previousUrl = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const storageWarning = useRef(false);

  useEffect(() => {
    active.current = true;
    try {
      setData(readDraft() ?? createOfferDefaults());
    } catch {
      setData(createOfferDefaults());
      toast.error("Your saved draft couldn’t be read. A new offer is ready.");
    }
    return () => {
      active.current = false;
      if (previousUrl.current) URL.revokeObjectURL(previousUrl.current);
    };
  }, []);

  const key = data ? JSON.stringify(data) : "";
  const ready = !!generated && generated.key === key;
  const pending = !!data && !ready && !pdfError;

  // Save draft changes independently of PDF generation, including unfinished fields.
  useEffect(() => {
    if (!data) return;
    setSaved(false);
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
        setSaved(true);
        setStorageUnavailable(false);
      } catch {
        setStorageUnavailable(true);
        if (!storageWarning.current) {
          toast.error(
            "Browser storage is unavailable. Keep this page open and download your PDF to save the offer.",
          );
          storageWarning.current = true;
        }
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [data]);

  // One render at a time; superseded drafts never become downloadable.
  const renderPending = useCallback(async () => {
    if (rendering.current) return;
    rendering.current = true;
    try {
      while (latestRequest.current && active.current) {
        const request = latestRequest.current;
        latestRequest.current = null;
        try {
          const blob = await pdf(
            <OfferDocument data={request.data} />,
          ).toBlob();
          if (!active.current || latestRequest.current) continue;
          const url = URL.createObjectURL(blob);
          const oldUrl = previousUrl.current;
          previousUrl.current = url;
          setGenerated({ key: request.key, blob, url });
          setPdfError(null);
          // Give the preview time to release the previous document.
          if (oldUrl)
            window.setTimeout(() => URL.revokeObjectURL(oldUrl), 2000);
        } catch {
          if (active.current && !latestRequest.current)
            setPdfError(
              "Please try again. If this continues, check your offer details or refresh the page.",
            );
        }
      }
    } finally {
      rendering.current = false;
    }
  }, []);

  useEffect(() => {
    if (!data) return;
    setPdfError(null);
    latestRequest.current = { data, key };
    const timer = window.setTimeout(() => {
      void renderPending();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [data, key, renderPending, revision]);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (dialog && !element.open) element.showModal();
    if (!dialog && element.open) element.close();
  }, [dialog]);

  const changeData = (next: OfferData) => {
    setData(next);
    setErrors({});
  };

  const download = () => {
    if (!data || !ready || !generated) return;
    const parsed = offerSchema.safeParse(data);
    if (!parsed.success) {
      const fieldErrors: FormErrors = {};
      parsed.error.issues.forEach((issue) => {
        const field = issue.path[0] as keyof OfferData;
        if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
      });
      setErrors(fieldErrors);
      setMobileTab("edit");
      toast.error(
        "Please complete the highlighted offer details before downloading.",
      );
      const firstField = Object.keys(fieldErrors)[0];
      window.setTimeout(() => {
        const input = document.getElementById(firstField);
        const section = input?.closest("details");
        if (section) section.open = true;
        input?.focus();
        input?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 50);
      return;
    }
    const link = document.createElement("a");
    link.href = generated.url;
    link.download = offerFilename(data);
    document.body.appendChild(link);
    link.click();
    link.remove();
    try {
      setRecords(recordDownload(data));
      toast.success(
        "Offer letter downloaded and saved in this browser’s history.",
      );
    } catch {
      toast.success("Offer letter downloaded.");
      toast.warning(
        "The PDF was downloaded, but browser history could not be saved.",
      );
    }
  };

  const openHistory = () => {
    try {
      setRecords(readHistory());
    } catch {
      setRecords([]);
      toast.error("Your offer history couldn’t be read.");
    }
    setSearch("");
    setDialog("history");
  };

  const loadRecord = (record: OfferRecord, fresh: boolean) => {
    const defaults = createOfferDefaults();
    const next = fresh
      ? {
          ...record.data,
          employeeName: "",
          employeeEmail: "",
          employeeAddress: "",
          salutation: "" as const,
          offerDate: defaults.offerDate,
          joiningDate: defaults.joiningDate,
          acceptanceDeadline: "",
        }
      : record.data;
    changeData(next);
    setMobileTab("edit");
    setDialog(null);
    toast.success(
      fresh
        ? "Terms copied. Enter the new employee’s details."
        : "Offer loaded for editing.",
    );
  };

  const deleteRecord = (id: string) => {
    try {
      const next = records.filter((record) => record.id !== id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      setRecords(next);
    } catch {
      toast.error("Couldn’t remove this offer from browser history.");
    }
  };

  const newOffer = () => {
    changeData(createOfferDefaults());
    setDialog(null);
    setMobileTab("edit");
    toast.success("New offer ready. Your downloaded offers remain in history.");
  };

  if (!data)
    return (
      <main className="loading-app">
        <LoaderCircle className="spin" size={25} />
        Loading CarePal Offer Letter Creator…
      </main>
    );
  const filtered = records.filter((record) =>
    `${record.data.employeeName} ${record.data.role}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <>
      <main className="app-shell">
        <header className="app-header">
          <div className="brand">
            <img
              src={getPublicAssetPath("/carepal-logo.png")}
              alt="CarePal logo"
              width={36}
              height={36}
            />
            <div>
              <h1>CarePal Offer Letter Creator</h1>
              <p>Carepalz Internet Private Limited</p>
            </div>
          </div>
          <div className="header-actions">
            {SHOW_PREVIOUS_OFFERS && (
              <button
                className="button button-outline button-small"
                type="button"
                onClick={openHistory}
              >
                <History size={16} />
                Previous offers
              </button>
            )}
            <button
              className="button button-outline button-small"
              type="button"
              onClick={() => setDialog("new")}
            >
              <FilePlus2 size={16} />
              New offer
            </button>
            <button
              className="button button-primary download-desktop"
              type="button"
              onClick={download}
              disabled={!ready}
            >
              {pending ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Download size={17} />
              )}
              {pending ? "Generating PDF…" : "Download PDF"}
            </button>
          </div>
        </header>

        <div
          className="mobile-tabs"
          role="tablist"
          aria-label="Offer workspace"
          onKeyDown={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "edit"
                  : event.key === "End"
                    ? "preview"
                    : mobileTab === "edit"
                      ? "preview"
                      : "edit";
              setMobileTab(next);
              document.getElementById(`${next}-tab`)?.focus();
            }
          }}
        >
          <button
            id="edit-tab"
            type="button"
            role="tab"
            aria-selected={mobileTab === "edit"}
            aria-controls="offer-edit"
            tabIndex={mobileTab === "edit" ? 0 : -1}
            className={mobileTab === "edit" ? "selected" : ""}
            onClick={() => setMobileTab("edit")}
          >
            <Pencil size={16} />
            Edit offer
          </button>
          <button
            id="preview-tab"
            type="button"
            role="tab"
            aria-selected={mobileTab === "preview"}
            aria-controls="offer-preview"
            tabIndex={mobileTab === "preview" ? 0 : -1}
            className={mobileTab === "preview" ? "selected" : ""}
            onClick={() => setMobileTab("preview")}
          >
            <FileText size={16} />
            Preview PDF
          </button>
        </div>

        <div className={`workspace mobile-${mobileTab}`}>
          <div
            className="form-panel"
            id="offer-edit"
            role="region"
            aria-label="Edit offer"
          >
            <OfferForm data={data} onChange={changeData} errors={errors} />
          </div>
          <div
            className="preview-panel"
            id="offer-preview"
            role="region"
            aria-label="Preview PDF"
          >
            <PdfPreview
              url={generated?.url ?? null}
              pending={pending}
              error={pdfError}
              filename={offerFilename(data)}
              onRetry={() => setRevision((value) => value + 1)}
            />
          </div>
        </div>

        <footer className="app-footer">
          <span className="save-status" role="status">
            {storageUnavailable ? (
              <AlertTriangle size={14} />
            ) : saved ? (
              <Check size={14} />
            ) : (
              <LoaderCircle size={13} className="spin" />
            )}
            {storageUnavailable
              ? "Draft not saved · download to keep a copy"
              : saved
                ? "Draft saved in this browser"
                : "Saving draft…"}
          </span>
          <span>English · INR · A4 PDF</span>
        </footer>
        <div className="mobile-download">
          <button
            className="button button-primary"
            type="button"
            onClick={download}
            disabled={!ready}
          >
            {pending ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Download size={17} />
            )}
            {pending ? "Generating PDF…" : "Download PDF"}
          </button>
        </div>
      </main>

      <dialog
        ref={dialogRef}
        className={`modal ${dialog === "history" ? "history-modal" : ""}`}
        onCancel={() => setDialog(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setDialog(null);
        }}
        aria-labelledby="dialog-title"
      >
        <div className="modal-header">
          <h2 id="dialog-title">
            {dialog === "history"
              ? "Previous offers"
              : dialog === "clear-history"
                ? "Clear offer history?"
                : "Create a new offer?"}
          </h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Close dialog"
            onClick={() => setDialog(null)}
          >
            <X size={20} />
          </button>
        </div>
        {dialog === "history" ? (
          <>
            <p className="modal-description">
              Downloaded offers are saved in this browser. Load an offer to edit
              it, or reuse its terms for a new employee.
            </p>
            <input
              className="history-search"
              aria-label="Search offers by name or role"
              placeholder="Search by employee name or role…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="history-list">
              {filtered.length ? (
                filtered.map((record) => (
                  <article className="history-item" key={record.id}>
                    <div className="history-file-icon">
                      <FileText size={21} />
                    </div>
                    <div className="history-info">
                      <h3>{record.data.employeeName}</h3>
                      <p>{record.data.role}</p>
                      <span>
                        Downloaded{" "}
                        {new Date(record.savedAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      <div className="history-actions">
                        <button
                          className="button button-outline button-small"
                          type="button"
                          onClick={() => loadRecord(record, false)}
                        >
                          Load offer
                        </button>
                        <button
                          className="button button-outline button-small"
                          type="button"
                          onClick={() => loadRecord(record, true)}
                        >
                          Reuse terms
                        </button>
                      </div>
                    </div>
                    <button
                      className="icon-button delete-button"
                      type="button"
                      aria-label={`Delete offer for ${record.data.employeeName}`}
                      onClick={() => deleteRecord(record.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </article>
                ))
              ) : (
                <div className="empty-history">
                  <History size={32} />
                  <strong>
                    {search ? "No matching offers" : "No downloaded offers yet"}
                  </strong>
                  <p>
                    {search
                      ? "Try another employee name or role."
                      : "Download your first offer letter to see it here."}
                  </p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <span>{records.length} of 50 offers · browser storage</span>
              {records.length > 0 && (
                <button
                  className="text-button delete-button"
                  type="button"
                  onClick={() => setDialog("clear-history")}
                >
                  Clear history
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="modal-description">
              {dialog === "clear-history"
                ? "This removes the downloaded offer records from this browser. Your current draft and downloaded PDF files will stay available."
                : "This replaces the current draft with a blank employee and the default CarePal terms. Download the current offer first if you want to keep it in history."}
            </p>
            <div className="confirmation-actions">
              <button
                className="button button-outline"
                type="button"
                onClick={() =>
                  setDialog(dialog === "clear-history" ? "history" : null)
                }
              >
                Cancel
              </button>
              <button
                className={`button ${dialog === "clear-history" ? "button-danger" : "button-primary"}`}
                type="button"
                onClick={
                  dialog === "clear-history"
                    ? () => {
                        try {
                          localStorage.removeItem(HISTORY_KEY);
                          setRecords([]);
                          setDialog("history");
                        } catch {
                          toast.error("Couldn’t clear browser history.");
                        }
                      }
                    : newOffer
                }
              >
                {dialog === "clear-history" ? (
                  <>
                    <Trash2 size={16} />
                    Clear history
                  </>
                ) : (
                  <>
                    <FilePlus2 size={16} />
                    Create new offer
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </dialog>
      {pdfError && (
        <div className="sr-only" role="alert">
          <AlertTriangle />
          PDF generation failed. Use Try again in the preview.
        </div>
      )}
      <Toaster richColors closeButton position="bottom-right" />
    </>
  );
}
