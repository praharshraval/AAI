/**
 * useStore.js - Zustand global state management for the RPA Agent Platform.
 *
 * Provides a centralized store with slices for agents, chat, execution logs,
 * HITL preview state, settings, live manifest pipeline, and sidecar lifecycle status.
 */

import { create } from 'zustand';

const useStore = create((set, get) => ({
  // ─── Agent Slice ────────────────────────────────────────────────────
  /** List of all saved agents retrieved from the Tauri backend. */
  agents: [],

  /** The agent currently selected / active in the UI. */
  currentAgent: null,

  /** Execution history entries for the current agent. */
  executionLogs: [],

  // ─── Chat & Pipeline Slice ──────────────────────────────────────────
  /**
   * Chat messages for the active session.
   * Each message: { id, role: 'user'|'assistant'|'system', content, timestamp, ... }
   */
  chatMessages: [],

  /** Active task manifest currently executing or generated. */
  activeManifest: null,

  /** Execution steps live progress tracking map: step_id -> { status, result, error } */
  stepProgress: {},

  // ─── HITL Preview Slice ─────────────────────────────────────────────
  /**
   * Data payload for the Human-In-The-Loop preview modal.
   * Shape: { type: 'pdf'|'text'|'csv'|'json', content, filename, metadata, draft_id, revision }
   */
  previewData: null,

  /** Whether the HITL preview modal is currently visible. */
  isPreviewOpen: false,

  // ─── Mid-Execution User Input Slice ─────────────────────────────────
  /**
   * Pending prompt for credentials or parameters during live execution.
   * Shape: { thread_id, prompt, field_name, is_secret }
   */
  pendingInputRequest: null,

  // ─── Settings Slice ─────────────────────────────────────────────────
  settings: {
    /** Whether a Gemini API key has been persisted in the secure store. */
    apiKeyConfigured: false,
    /** Results object from the last preflight check (null = never run). */
    preflightStatus: null,
  },

  // ─── Sidecar Lifecycle ──────────────────────────────────────────────
  /** Current status of the Python sidecar process. */
  sidecarStatus: 'idle', // 'idle' | 'running' | 'paused' | 'error'

  // ─── Actions ────────────────────────────────────────────────────────

  setPendingInputRequest: (req) => set({ pendingInputRequest: req }),
  clearPendingInputRequest: () => set({ pendingInputRequest: null }),

  addChatMessage: (msg) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, msg],
    })),

  setActiveManifest: (manifest) =>
    set({
      activeManifest: manifest,
      stepProgress: {},
    }),

  updateStepProgress: (stepId, update) =>
    set((state) => ({
      stepProgress: {
        ...state.stepProgress,
        [stepId]: {
          ...(state.stepProgress[stepId] || {}),
          ...update,
        },
      },
    })),

  setAgents: (agents) => set({ agents }),

  setCurrentAgent: (agent) => set({ currentAgent: agent }),

  setExecutionLogs: (logs) => set({ executionLogs: logs }),

  openPreview: (data) =>
    set({
      previewData: data,
      isPreviewOpen: true,
    }),

  closePreview: () =>
    set({
      previewData: null,
      isPreviewOpen: false,
    }),

  updateSettings: (partial) =>
    set((state) => ({
      settings: { ...state.settings, ...partial },
    })),

  setSidecarStatus: (status) => set({ sidecarStatus: status }),

  clearChat: () =>
    set({
      chatMessages: [],
      activeManifest: null,
      stepProgress: {},
    }),
}));

export default useStore;
