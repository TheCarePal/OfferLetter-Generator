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
  AlertTriangle,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { createOfferDefaults, offerSchema, type OfferData } from "@/lib/offer";
import { DRAFT_KEY, readDraft, offerFilename } from "@/lib/offer-storage";
import { useDocumentHistory } from "./document-history";
import { createOfferDraftFromArchive } from "@/lib/archive-draft";
import { getPublicAssetPath } from "@/lib/public-path";
import { OfferDocument } from "./offer-document";
import { OfferForm, type FormErrors } from "./offer-form";
import PdfPreview from "./pdf-preview";

type GeneratedPdf = { key: string; blob: Blob; url: string };
type Dialog = "new" | null;

export default function OfferCreator() {
  const [data, setData] = useState<OfferData | null>(null);
  const [saved, setSaved] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [generated, setGenerated] = useState<GeneratedPdf | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [errors, setErrors] = useState<FormErrors>({});
  const [dialog, setDialog] = useState<Dialog>(null);
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

  const history = useDocumentHistory({
    kind: "offers",
    schema: offerSchema,
    onLoad: (snapshot: unknown) => {
      changeData(offerSchema.parse(snapshot));
      setMobileTab("edit");
    },
    onReuse: (snapshot: unknown) => {
      changeData(createOfferDraftFromArchive(snapshot));
      setMobileTab("edit");
    },
  });

  const download = async () => {
    if (!data || !ready || !generated || history.busy) return;
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
    const snapshot = JSON.parse(JSON.stringify(data)) as OfferData;
    const filename = offerFilename(snapshot);
    try {
      const result = await history.archiveDownload({
        blob: generated.blob,
        snapshot,
        filename,
        label: snapshot.employeeName,
        subtitle: snapshot.role,
        documentDate: snapshot.offerDate,
      });
      if (result.status !== "saved") return;
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Offer saved to shared history and PDF downloaded.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The offer could not be saved. Check your connection and retry.",
      );
    }
  };

  const newOffer = () => {
    changeData(createOfferDefaults());
    setDialog(null);
    setMobileTab("edit");
    toast.success(
      "New offer ready. Previously saved PDFs remain in shared history.",
    );
  };

  if (!data)
    return (
      <main className="loading-app">
        <LoaderCircle className="spin" size={25} />
        Loading CarePal Offer Letter Creator…
      </main>
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
            {history.sessionActions}
            <button
              className="button button-outline button-small"
              type="button"
              onClick={history.openHistory}
              disabled={history.busy}
            >
              <History size={16} />
              Previous offers
            </button>
            <button
              className="button button-outline button-small"
              type="button"
              onClick={() => setDialog("new")}
              disabled={history.busy}
            >
              <FilePlus2 size={16} />
              New offer
            </button>
            <button
              className="button button-primary download-desktop"
              type="button"
              onClick={download}
              disabled={!ready || history.busy}
            >
              {pending || history.archiveBusy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Download size={17} />
              )}
              {history.archiveBusy
                ? "Saving PDF…"
                : pending
                  ? "Generating PDF…"
                  : "Save & download PDF"}
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
            <fieldset className="form-lock" disabled={history.archiveBusy}>
              <OfferForm data={data} onChange={changeData} errors={errors} />
            </fieldset>
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
            disabled={!ready || history.busy}
          >
            {pending || history.archiveBusy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Download size={17} />
            )}
            {history.archiveBusy
              ? "Saving PDF…"
              : pending
                ? "Generating PDF…"
                : "Save & download PDF"}
          </button>
        </div>
      </main>

      {history.dialogs}
      <dialog
        ref={dialogRef}
        className="modal"
        onCancel={() => setDialog(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setDialog(null);
        }}
        aria-labelledby="new-offer-title"
      >
        <div className="modal-header">
          <h2 id="new-offer-title">Create a new offer?</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Close dialog"
            onClick={() => setDialog(null)}
          >
            <X size={20} />
          </button>
        </div>
        <p className="modal-description">
          This replaces the current draft with a blank employee and the default
          CarePal terms. Save the current offer first to keep it in shared
          history.
        </p>
        <div className="confirmation-actions">
          <button
            className="button button-outline"
            type="button"
            onClick={() => setDialog(null)}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={newOffer}
          >
            <FilePlus2 size={16} />
            Create new offer
          </button>
        </div>
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
