/**
 * PreviewModal.jsx - Human-In-The-Loop (HITL) Deliverable Inspector
 *
 * Professional verification drawer and approval console.
 * Allows users to review generated automation deliverables, inspect source formatting,
 * and issue revision requests with custom feedback before final persistence.
 */

import React, { useState, useCallback } from 'react';
import {
  X,
  FileText,
  Check,
  Edit3,
  Loader2,
  FileCode,
  FileSpreadsheet,
  CornerDownLeft,
  Eye,
  Code2,
  FolderOpen,
} from 'lucide-react';
import useStore from '../hooks/useStore';
import useTauri from '../hooks/useTauri';

const FAST_FEEDBACK = [
  'Add executive summary metrics at the top',
  'Format data into structured Markdown tables',
  'Include actionable recommendations section',
  'Summarize key variance findings',
];

export default function PreviewModal() {
  const previewData = useStore((s) => s.previewData);
  const isOpen = useStore((s) => s.isPreviewOpen);
  const closePreview = useStore((s) => s.closePreview);
  const setSidecarStatus = useStore((s) => s.setSidecarStatus);

  const { sendSidecarInput, openFileInFinder } = useTauri();

  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState('formatted'); // 'formatted' | 'raw'

  if (!isOpen || !previewData) return null;

  const { type, content, filename, metadata, revision } = previewData;

  const handleApprove = async () => {
    setIsSubmitting(true);
    await sendSidecarInput({ action: 'approve' });
    setSidecarStatus('running');
    closePreview();
    setIsSubmitting(false);
  };

  const handleRequestRevision = async () => {
    if (!feedback.trim()) return;
    setIsSubmitting(true);
    await sendSidecarInput({
      action: 'request_changes',
      feedback: feedback.trim(),
    });
    setFeedback('');
    setIsSubmitting(false);
  };

  const lines = (content || '').split('\n');
  const wordCount = (content || '').trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-zinc-800 bg-[#0d0d11] shadow-2xl overflow-hidden">
        {/* ── Modal Header ─────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-[#121216] px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-zinc-800 text-zinc-300">
              {type === 'csv' ? <FileSpreadsheet size={16} /> : <FileText size={16} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-zinc-100">{filename}</h2>
                <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400 uppercase">
                  {type}
                </span>
                <span className="rounded bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                  Revision {revision || 1}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                Human-in-the-Loop review checkpoint · {lines.length} lines · {wordCount} words
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const target = previewData.metadata?.desktop_path || previewData.filename || 'automation_output.md';
                openFileInFinder(target);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
              title="Reveal in macOS Finder"
            >
              <FolderOpen size={13} className="text-emerald-400" />
              <span>Show in Finder</span>
            </button>

            <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-xs">
              <button
                onClick={() => setViewMode('formatted')}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors ${
                  viewMode === 'formatted'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Eye size={12} />
                Preview
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors ${
                  viewMode === 'raw'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Code2 size={12} />
                Source
              </button>
            </div>

            <button
              onClick={closePreview}
              className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Document Body ────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-[#09090b] p-6">
          {viewMode === 'formatted' ? (
            <div className="mx-auto max-w-3xl space-y-4 font-sans text-sm leading-relaxed text-zinc-300">
              {content ? (
                <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-300 bg-zinc-950/80 p-5 rounded-lg border border-zinc-800/80">
                  {content}
                </div>
              ) : (
                <p className="text-zinc-500 italic">No output text generated for this deliverable.</p>
              )}
            </div>
          ) : (
            <div className="flex font-mono text-xs leading-relaxed">
              {/* Line numbers gutter */}
              <div className="select-none pr-4 text-right text-zinc-600 border-r border-zinc-800/80 mr-4 shrink-0">
                {lines.map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <pre className="flex-1 overflow-x-auto text-zinc-300 whitespace-pre">
                {content}
              </pre>
            </div>
          )}
        </div>

        {/* ── Review Action Footer ─────────────────────────────── */}
        <div className="shrink-0 border-t border-zinc-800 bg-[#121216] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-zinc-400 mr-1">Feedback Presets:</span>
            {FAST_FEEDBACK.map((preset) => (
              <button
                key={preset}
                onClick={() => setFeedback(preset)}
                className="rounded border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <input
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Optional revision directive or change instructions..."
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
              <button
                onClick={handleRequestRevision}
                disabled={!feedback.trim() || isSubmitting}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Edit3 size={13} />
                Request Changes
              </button>

              <button
                onClick={handleApprove}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors shadow-sm disabled:opacity-40"
              >
                {isSubmitting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
                Approve & Persist Deliverable
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
