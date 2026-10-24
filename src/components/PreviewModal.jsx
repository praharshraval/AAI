/**
 * PreviewModal.jsx - Human-In-The-Loop (HITL) interactive preview modal.
 *
 * Displays draft artefacts for user review before the sidecar executes them.
 * Supports approve / request-changes / incremental revision workflow.
 */

import React, { useState, useCallback } from 'react';
import {
  X,
  FileText,
  Check,
  Edit3,
  Loader2,
  FileJson,
  FileSpreadsheet,
} from 'lucide-react';
import useStore from '../hooks/useStore';
import useTauri from '../hooks/useTauri';

// ─── Helpers ───────────────────────────────────────────────────────────

/** Pick an icon component based on file type. */
function FileIcon({ type }) {
  switch (type) {
    case 'json':
      return <FileJson size={18} className="text-amber-400" />;
    case 'csv':
      return <FileSpreadsheet size={18} className="text-green-400" />;
    default:
      return <FileText size={18} className="text-blue-400" />;
  }
}

/** Badge colour per file type. */
const TYPE_BADGE = {
  pdf: 'bg-red-600/20 text-red-300',
  text: 'bg-blue-600/20 text-blue-300',
  csv: 'bg-green-600/20 text-green-300',
  json: 'bg-amber-600/20 text-amber-300',
};

/** Simple line-number gutter + content renderer. */
function LineNumberedContent({ text }) {
  const lines = text.split('\n');
  return (
    <div className="flex text-xs font-mono">
      {/* Gutter */}
      <div className="select-none pr-4 text-right text-gray-600 border-r border-gray-700/50 mr-4 shrink-0">
        {lines.map((_, i) => (
          <div key={i} className="leading-5">
            {i + 1}
          </div>
        ))}
      </div>
      {/* Content */}
      <pre className="flex-1 overflow-x-auto leading-5 text-gray-300 whitespace-pre">
        {text}
      </pre>
    </div>
  );
}

/** Minimal JSON syntax colouring via string replacement. */
function JsonHighlighter({ text }) {
  // Tokenise keys, strings, numbers, booleans, and null.
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Keys
    .replace(
      /("(?:[^"\\]|\\.)*")\s*:/g,
      '<span class="text-indigo-400">$1</span>:'
    )
    // String values
    .replace(
      /:\s*("(?:[^"\\]|\\.)*")/g,
      ': <span class="text-green-400">$1</span>'
    )
    // Numbers
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="text-amber-300">$1</span>')
    // Booleans & null
    .replace(
      /:\s*(true|false|null)/g,
      ': <span class="text-rose-400">$1</span>'
    );

  return (
    <pre
      className="text-xs font-mono leading-5 text-gray-300"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ─── Main Component ────────────────────────────────────────────────────

export default function PreviewModal() {
  const previewData = useStore((s) => s.previewData);
  const isOpen = useStore((s) => s.isPreviewOpen);
  const closePreview = useStore((s) => s.closePreview);
  const setSidecarStatus = useStore((s) => s.setSidecarStatus);

  const { sendSidecarInput } = useTauri();

  const [isRequestingChanges, setIsRequestingChanges] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [revision, setRevision] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen || !previewData) return null;

  const { type, content, filename, metadata } = previewData;
  const badgeClass = TYPE_BADGE[type] ?? TYPE_BADGE.text;

  // ── Approve ─────────────────────────────────────────────────────
  const handleApprove = useCallback(async () => {
    setIsLoading(true);
    await sendSidecarInput({ action: 'approve' });
    setSidecarStatus('running');
    closePreview();
    setIsLoading(false);
    setRevision(1);
    setIsRequestingChanges(false);
    setFeedback('');
  }, [sendSidecarInput, setSidecarStatus, closePreview]);

  // ── Submit feedback ─────────────────────────────────────────────
  const handleSubmitFeedback = useCallback(async () => {
    if (!feedback.trim()) return;
    setIsLoading(true);
    await sendSidecarInput({
      action: 'request_changes',
      feedback: feedback.trim(),
    });
    setFeedback('');
    setRevision((r) => r + 1);
    setIsLoading(false);
    // Keep modal open – the sidecar will push an updated preview.
  }, [feedback, sendSidecarInput]);

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-gray-700/50 bg-gray-900 shadow-2xl">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <FileIcon type={type} />
            <div>
              <h2 className="text-sm font-semibold text-gray-100">
                {filename}
              </h2>
              <div className="mt-0.5 flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${badgeClass}`}
                >
                  {type}
                </span>
                <span className="text-[10px] text-gray-500">
                  Revision {revision}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              closePreview();
              setRevision(1);
              setIsRequestingChanges(false);
              setFeedback('');
            }}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Content ────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 size={28} className="animate-spin text-indigo-400" />
              <span className="ml-3 text-sm text-gray-400">
                Waiting for updated draft…
              </span>
            </div>
          ) : type === 'pdf' ? (
            <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 text-sm text-gray-500">
              <FileText size={32} className="mb-2 text-gray-600" />
              <p>PDF preview generated at:</p>
              <code className="mt-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-400">
                {metadata?.path ?? filename}
              </code>
            </div>
          ) : type === 'json' ? (
            <div className="rounded-xl bg-gray-950/50 p-4 overflow-x-auto">
              <JsonHighlighter text={content} />
            </div>
          ) : (
            <div className="rounded-xl bg-gray-950/50 p-4 overflow-x-auto">
              <LineNumberedContent text={content} />
            </div>
          )}

          {/* Diff placeholder (metadata may contain original for comparison) */}
          {metadata?.original && revision > 1 && (
            <div className="mt-4 rounded-xl border border-gray-700/40 bg-gray-950/30 p-4">
              <h4 className="mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Previous Version (Diff)
              </h4>
              <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                <div>
                  <p className="mb-1 text-red-400 text-[10px]">Original</p>
                  <pre className="whitespace-pre-wrap text-gray-500 line-through">
                    {metadata.original}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-green-400 text-[10px]">Updated</p>
                  <pre className="whitespace-pre-wrap text-gray-300">
                    {content}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Change Request Area ─────────────────────────────────── */}
        {isRequestingChanges && (
          <div className="border-t border-gray-800 px-6 py-4">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Describe what should be changed…"
              rows={3}
              className="w-full resize-none rounded-xl border border-gray-700 bg-gray-800/70 px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 outline-none transition-colors focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500/30"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={handleSubmitFeedback}
                disabled={!feedback.trim() || isLoading}
                className="flex items-center gap-1.5 rounded-lg bg-yellow-600/80 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Edit3 size={14} />
                )}
                Submit Feedback
              </button>
            </div>
          </div>
        )}

        {/* ── Footer Actions ─────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-800 px-6 py-4">
          <button
            onClick={() => setIsRequestingChanges(!isRequestingChanges)}
            className="flex items-center gap-2 rounded-xl border border-yellow-600/50 bg-yellow-600/10 px-5 py-2.5 text-sm font-medium text-yellow-300 transition-all hover:bg-yellow-600/20"
          >
            <Edit3 size={15} />
            {isRequestingChanges ? 'Cancel Changes' : 'Request Changes'}
          </button>
          <button
            onClick={handleApprove}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-green-900/30 transition-all hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Check size={15} />
            )}
            Approve &amp; Execute
          </button>
        </div>
      </div>
    </div>
  );
}
