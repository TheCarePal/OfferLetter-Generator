"use client";

import { Document, Page, pdfjs } from "react-pdf";
import {
  FileText,
  LoaderCircle,
  Minus,
  Plus,
  Printer,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getPublicAssetPath } from "@/lib/public-path";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = getPublicAssetPath("/pdf.worker.min.mjs");

export default function PdfPreview({
  url,
  pending,
  error,
  filename,
  onRetry,
}: {
  url: string | null;
  pending: boolean;
  error: string | null;
  filename: string;
  onRetry: () => void;
}) {
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(600);
  const [previewError, setPreviewError] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, entry.contentRect.width - 40)),
    );
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setPreviewError(false);
  }, [url]);

  const print = () => {
    if (!url) return;
    const frame = document.createElement("iframe");
    frame.className = "print-frame";
    frame.title = "Print offer letter";
    frame.src = url;
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    };
    document.body.appendChild(frame);
    window.setTimeout(() => frame.remove(), 120_000);
  };

  return (
    <section className="pdf-preview" aria-label="Offer letter PDF preview">
      <div className="pdf-toolbar">
        <div className="pdf-title">
          <FileText size={17} aria-hidden="true" />
          <span title={filename}>{filename}</span>
        </div>
        <div className="pdf-tools">
          <span className="page-count">{pages ? `${pages} pages` : "A4"}</span>
          <span className="toolbar-divider" />
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= 0.6}
            onClick={() => setZoom((value) => Math.max(0.6, value - 0.1))}
          >
            <Minus size={16} />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= 1.5}
            onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}
          >
            <Plus size={16} />
          </button>
          <span className="toolbar-divider" />
          <button
            type="button"
            aria-label="Print offer letter"
            title="Print offer letter"
            onClick={print}
            disabled={!url || pending || !!error}
          >
            <Printer size={17} />
          </button>
          <a
            aria-label="Open PDF in a new tab"
            title="Open PDF in a new tab"
            href={!pending && !error ? (url ?? undefined) : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!url || pending || !!error}
            tabIndex={!url || pending || !!error ? -1 : undefined}
            className={!url || pending || !!error ? "disabled-link" : ""}
          >
            <ExternalLink size={17} />
          </a>
        </div>
      </div>
      <div className="pdf-viewport" ref={viewport} aria-busy={pending}>
        {pending && (
          <div className="preview-updating">
            <LoaderCircle size={13} className="spin" />
            Updating preview…
          </div>
        )}
        {error ? (
          <div className="preview-message" role="alert">
            <FileText size={28} />
            <strong>Couldn’t generate the PDF</strong>
            <p>{error}</p>
            <button
              className="button button-outline"
              type="button"
              onClick={onRetry}
            >
              <RefreshCw size={15} />
              Try again
            </button>
          </div>
        ) : !url ? (
          <div className="preview-message">
            <LoaderCircle size={28} className="spin" />
            <p>Preparing your offer letter…</p>
          </div>
        ) : previewError ? (
          <div className="preview-message">
            <p>The PDF preview couldn’t load.</p>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="button button-outline"
            >
              Open PDF
            </a>
          </div>
        ) : (
          <Document
            file={url}
            loading={
              <div className="preview-message">
                <LoaderCircle size={28} className="spin" />
                <p>Loading PDF preview…</p>
              </div>
            }
            onLoadSuccess={({ numPages }) => setPages(numPages)}
            onLoadError={() => setPreviewError(true)}
          >
            {Array.from({ length: pages }, (_, index) => (
              <div className="preview-page" key={index}>
                <Page
                  pageNumber={index + 1}
                  width={Math.min(width, 840) * zoom}
                  renderTextLayer
                  renderAnnotationLayer={false}
                  loading={
                    <div className="page-loading">
                      Loading page {index + 1}…
                    </div>
                  }
                />
                <span className="page-caption">
                  Page {index + 1} of {pages}
                </span>
              </div>
            ))}
          </Document>
        )}
      </div>
    </section>
  );
}
