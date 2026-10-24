/**
 * useStore.js - Zustand global state management for the RPA Agent Platform.
 *
 * Provides a centralized store with slices for agents, chat, execution logs,
 * HITL preview state, settings, and sidecar lifecycle status.
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

  // ─── Chat Slice ─────────────────────────────────────────────────────
  /**
   * Chat messages for the active session.
   * Each message: { id, role: 'user'|'assistant'|'system', content, timestamp }
   */
  chatMessages: [],

  // ─── HITL Preview Slice ─────────────────────────────────────────────
  /**
   * Data payload for the Human-In-The-Loop preview modal.
   * Shape: { type: 'pdf'|'text'|'csv'|'json', content, filename, metadata }
   */
  previewData: null,

  /** Whether the HITL preview modal is currently visible. */
  isPreviewOpen: false,

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

  /**
   * Append a chat message to the session history.
   * @param {Object} msg - { id, role, content, timestamp }
   */
  addChatMessage: (msg) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, msg],
    })),

  /**
   * Replace the entire agents list (typically after fetching from backend).
   * @param {Array} agents
   */
  setAgents: (agents) => set({ agents }),

  /**
   * Set the currently active agent.
   * @param {Object|null} agent
   */
  setCurrentAgent: (agent) => set({ currentAgent: agent }),

  /**
   * Replace execution logs for the current agent.
   * @param {Array} logs
   */
  setExecutionLogs: (logs) => set({ executionLogs: logs }),

  /**
   * Open the HITL preview modal with the provided data.
   * @param {Object} data - { type, content, filename, metadata }
   */
  openPreview: (data) =>
    set({
      previewData: data,
      isPreviewOpen: true,
    }),

  /** Close the HITL preview modal and clear its data. */
  closePreview: () =>
    set({
      previewData: null,
      isPreviewOpen: false,
    }),

  /**
   * Shallow-merge partial settings into the existing settings object.
   * @param {Object} partial - Partial settings to merge.
   */
  updateSettings: (partial) =>
    set((state) => ({
      settings: { ...state.settings, ...partial },
    })),

  /**
   * Update sidecar process status.
   * @param {'idle'|'running'|'paused'|'error'} status
   */
  setSidecarStatus: (status) => set({ sidecarStatus: status }),

  /** Clear all chat messages for the current session. */
  clearChat: () => set({ chatMessages: [] }),
}));

export default useStore;
