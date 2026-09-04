"use client";

import React, { useRef, useState, useCallback, useEffect, useId, useLayoutEffect, useImperativeHandle, forwardRef, KeyboardEvent } from "react";
import type { BuiltinSlashCommandResult, CompactResultInfo, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import { formatCompactCount } from "@/lib/i18n/format";
import type { SkillsResponse } from "@/lib/api-types";
import type { TextContent, UserMessage } from "@/lib/types";
import {
  clearDraft,
  getDraft,
  mergeRestoredSubmissionDraft,
  mergeRestoredSubmissionText,
  rekeyDraft as rekeyStoredDraft,
  setDraft,
  type ChatDraftImage,
} from "@/lib/draft-store";
import {
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "@/lib/image-attachments";
import {
  buildEntriesFromFiles, buildAtInsertText, extractAtQuery, filterFileEntries, isFilePathQuery,
  type AtQueryMatch, type FileIndexEntry,
} from "@/lib/file-fuzzy";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { ModelSelector, type ModelSelectorOption } from "./ModelSelector";

export { filterModelOptions } from "./ModelSelector";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  modelError?: string | null;
  /** Diagnostics from resolving `enabledModels`, e.g. a pattern that matched nothing. */
  modelScopeWarnings?: string[];
  onModelChange?: (provider: string, modelId: string) => void;
  modelSwitching?: boolean;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  compactWarning?: boolean;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  inputHistory?: string[];
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  replaceMessage: (message: UserMessage) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
  rekeyDraft: (previousKey: string, nextKey: string) => void;
  restoreSubmission: (text: string, images?: ChatDraftImage[], targetDraftKey?: string) => void;
}

const COMPOSITION_END_ENTER_GRACE_MS = 100;
const TEXT_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
type StreamingAction = "steer" | "followup";

/**
 * Shell-style history cycling. `cycle` counts back from the newest prompt, or
 * is null when not cycling; `history` is oldest-first. Walking forward off the
 * end restores the empty composer.
 */
export function cycleInputHistory(
  history: string[],
  cycle: number | null,
  direction: "up" | "down",
): { cycle: number | null; text: string } {
  if (direction === "up") {
    if (history.length === 0) return { cycle: null, text: "" };
    const next = Math.min(history.length - 1, (cycle ?? -1) + 1);
    return { cycle: next, text: history[history.length - 1 - next] ?? "" };
  }
  const next = (cycle ?? 0) - 1;
  if (next < 0) return { cycle: null, text: "" };
  return { cycle: next, text: history[history.length - 1 - next] ?? "" };
}

/**
 * Height cap for a menu anchored upward from the composer. Both completion
 * menus sit `bottom: calc(100% + 8px)` inside a scroll container, so a cap in
 * vh can render their top -- including the sticky header -- above the
 * container's edge, where scrolling cannot reach it.
 */
export function getAnchoredMenuMaxHeight(menuBottom: number, visibleTop: number, gap = 8): number {
  return Math.max(0, Math.floor(menuBottom - visibleTop - gap));
}

function getVisibleTopBoundary(element: HTMLElement): number {
  let visibleTop = window.visualViewport?.offsetTop ?? 0;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      visibleTop = Math.max(visibleTop, parent.getBoundingClientRect().top + parent.clientTop);
    }
  }
  return visibleTop;
}

export function getStreamingSubmissionAction(
  selected: StreamingAction,
  hasSteer: boolean,
  hasFollowUp: boolean,
): StreamingAction | null {
  if (selected === "steer" && hasSteer) return "steer";
  if (selected === "followup" && hasFollowUp) return "followup";
  if (hasSteer) return "steer";
  if (hasFollowUp) return "followup";
  return null;
}

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVEL_DESC_KEYS: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "chat.thinkingUseDefault", off: "chat.thinkingOff", minimal: "chat.thinkingMinimal", low: "chat.thinkingLow",
  medium: "chat.thinkingMedium", high: "chat.thinkingHigh", xhigh: "chat.thinkingXhigh", max: "chat.thinkingMax",
};

type BuiltinSlashCommand = {
  name: string;
  description: string;
  source: "builtin";
  availableWhileStreaming?: boolean;
};

type SlashCommandPaletteItem = SlashCommandInfo | BuiltinSlashCommand;

type SlashCommandSource = SlashCommandPaletteItem["source"];

const BUILTIN_SLASH_COMMANDS: BuiltinSlashCommand[] = [
  { name: "compact", description: "chat.commandCompact", source: "builtin" },
  { name: "reload", description: "chat.commandReload", source: "builtin" },
  { name: "name", description: "chat.commandName", source: "builtin" },
  { name: "session", description: "chat.commandSession", source: "builtin", availableWhileStreaming: true },
  { name: "copy", description: "chat.commandCopy", source: "builtin", availableWhileStreaming: true },
  { name: "clone", description: "chat.commandClone", source: "builtin" },
];

function getBuiltinSlashCommand(message: string): BuiltinSlashCommand | undefined {
  const match = message.trim().match(/^\/([^\s]+)(?:\s|$)/);
  if (!match) return undefined;
  return BUILTIN_SLASH_COMMANDS.find((command) => command.name === match[1]);
}

export function canRunBuiltinSlashCommandWhileStreaming(message: string): boolean {
  return getBuiltinSlashCommand(message)?.availableWhileStreaming === true;
}

export function isExactSlashCommand(message: string, command: SlashCommandPaletteItem): boolean {
  return command.source === "builtin" && message.trim() === `/${command.name}`;
}

export function canClearBuiltinCommandInput(message: string, imageCount: number, submittedMessage: string): boolean {
  return imageCount === 0 && message.trim() === submittedMessage;
}

const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

const SLASH_SOURCE_GROUP_LABEL_KEYS: Record<SlashCommandSource, string> = {
  builtin: "chat.builtIn",
  extension: "chat.extensions",
  prompt: "chat.prompts",
  skill: "chat.skills",
};

const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

function slashMatchRank(command: SlashCommandPaletteItem, query: string, t: (key: string) => string): number {
  const name = command.name.toLowerCase();
  const description = getSlashDescription(command, t).toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}

function getSlashDescription(command: SlashCommandPaletteItem, t: (key: string) => string): string {
  return command.source === "builtin" ? t(command.description) : command.description ?? "";
}

// Skill slash commands are named "skill:<skillName>"; look the skill up in the
// mode map fetched from /api/skills. Unknown skills remain unannotated.
function isManualSkillCommand(command: SlashCommandPaletteItem, skillModes: Record<string, boolean>): boolean {
  if (command.source !== "skill" || !command.name.startsWith("skill:")) return false;
  return skillModes[command.name.slice("skill:".length)] === true;
}

export function buildSlashCommandLayout(commands: SlashCommandPaletteItem[]) {
  let index = 0;
  const groups = SLASH_SOURCES
    .map((source) => ({
      source,
      items: commands
        .filter((command) => command.source === source)
        .map((command) => ({ command, index: index++ })),
    }))
    .filter((group) => group.items.length > 0);

  return {
    commands: groups.flatMap((group) => group.items.map(({ command }) => command)),
    groups,
  };
}

const CLIENT_IMAGE_COMPRESSION_THRESHOLD_BYTES = 1024 * 1024;
const CLIENT_MAX_IMAGE_SIDE = 1024;
const CLIENT_JPEG_QUALITY = 0.85;

export function shouldCompressImageFile(file: Pick<File, "size" | "type">): boolean {
  return file.size > CLIENT_IMAGE_COMPRESSION_THRESHOLD_BYTES && file.type !== "image/gif";
}

function readImageFile(file: Blob, mimeType: string): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === "string" ? reader.result.split(",")[1] : undefined;
      if (!data) {
        reject(new Error("Failed to read image"));
        return;
      }
      resolve({ data, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function compressImageFile(file: File): Promise<{ data: string; mimeType: string }> {
  const original = () => readImageFile(file, file.type);
  if (!shouldCompressImageFile(file) || typeof createImageBitmap !== "function") return original();

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return original();

  try {
    const scale = Math.min(1, CLIENT_MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return original();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", CLIENT_JPEG_QUALITY).split(",")[1];
    return data && data.length < Math.ceil(file.size / 3) * 4
      ? { data, mimeType: "image/jpeg" }
      : original();
  } catch {
    return original();
  } finally {
    bitmap.close();
  }
}

function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}

function draftImagesToAttachedImages(images: ChatDraftImage[] | undefined): AttachedImage[] {
  return (images ?? [])
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(draftImageToAttachedImage);
}

export function canRestoreUserMessage(
  value: string,
  attachedImageCount: number,
  pendingImageCount: number,
): boolean {
  return !value.trim() && attachedImageCount === 0 && pendingImageCount === 0;
}

export function getUserMessageText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function getUserMessageDraftImages(message: UserMessage): ChatDraftImage[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((block) => {
    if (block.type !== "image") return [];

    // Support both the current nested image format and older flat pi-ai entries.
    const flat = block as unknown as { data?: unknown; mimeType?: unknown };
    const data = block.source?.type === "base64" ? block.source.data : flat.data;
    const mimeType = block.source?.type === "base64" ? block.source.media_type : flat.mimeType;
    if (typeof data !== "string" || typeof mimeType !== "string") return [];

    const image = { data, mimeType };
    return isBase64ImageWithinLimits(image) ? [image] : [];
  });
}

function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

function QueuedMessageRow({ kind, text }: { kind: "steer" | "follow-up"; text: string }) {
  return (
    <div
      title={text}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 10px",
        fontSize: 12,
        color: "var(--text-muted)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          padding: "1px 7px",
          borderRadius: 999,
          border: `1px solid ${kind === "steer" ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"}`,
          color: kind === "steer" ? "var(--accent)" : "var(--text-dim)",
        }}
      >
        {kind}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
    </div>
  );
}

function ModelNoticeBanner({ tone, title, body }: { tone: "error" | "warning"; title: string; body: string }) {
  const color = tone === "error" ? "239,68,68" : "234,179,8";
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        maxHeight: 120,
        marginBottom: 8,
        padding: "7px 10px",
        overflowY: "auto",
        border: `1px solid rgba(${color},0.3)`,
        borderRadius: 6,
        background: `rgba(${color},0.07)`,
        color: `rgb(${color})`,
        fontSize: 11,
        lineHeight: 1.45,
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 1 }}
        aria-hidden="true"
      >
        <path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body}</div>
      </div>
    </div>
  );
}

export function ModelErrorBanner({ error }: { error?: string | null }) {
  const { t } = useI18n();
  if (!error) return null;
  return <ModelNoticeBanner tone="error" title={t("chat.modelError")} body={error} />;
}

/** Surfaces `enabledModels` patterns that matched nothing, so a typo is visible (#307). */
export function ModelScopeWarningBanner({ warnings }: { warnings?: string[] }) {
  const { t } = useI18n();
  if (!warnings || warnings.length === 0) return null;
  return (
    <ModelNoticeBanner
      tone="warning"
      title={t(warnings.length > 1 ? "chat.modelScopeWarnings" : "chat.modelScopeWarning")}
      body={warnings.join("\n")}
    />
  );
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, model, isAutoModelSelection, modelNames, modelList, modelError, modelScopeWarnings, onModelChange, modelSwitching,
  onCompact, onAbortCompaction, isCompacting, compactError, compactResult, compactWarning,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo, queuedMessages, inputHistory = [], onRecallQueue,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  onAudioUnlock,
  onPromptWithStreamingBehavior,
  draftKey,
  cwd,
}: Props, ref) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [value, setValue] = useState(() => (draftKey ? getDraft(draftKey)?.value ?? "" : ""));
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [streamingAction, setStreamingAction] = useState<StreamingAction>("steer");
  const [streamingActionMenuOpen, setStreamingActionMenuOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftKey ? draftImagesToAttachedImages(getDraft(draftKey)?.images) : []
  ));
  const trimmedValue = value.trimStart();
  const bashMode = attachedImages.length === 0 && trimmedValue.startsWith("!");
  const bashExcluded = bashMode && trimmedValue.startsWith("!!");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [anchoredMenuMaxHeight, setAnchoredMenuMaxHeight] = useState<number | null>(null);
  const anchoredMenuRef = useRef<HTMLDivElement>(null);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  // Shell-style history cycling: null when not cycling, otherwise how many
  // prompts back from the newest we are showing.
  const [historyCycle, setHistoryCycle] = useState<number | null>(null);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[]; failed?: boolean } | null>(null);
  const [skillModeState, setSkillModeState] = useState<{
    cwd: string;
    values: Record<string, boolean>;
  } | null>(null);
  const skillModes = cwd && skillModeState?.cwd === cwd
    ? skillModeState.values
    : {};

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const runActionMenuRef = useRef<HTMLDivElement>(null);
  const runActionMenuId = useId();
  const thinkingMenuId = useId();
  const thinkingMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  const pendingImageCountRef = useRef(0);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      valueRef.current = text;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
      });
    },
    replaceMessage(message: UserMessage) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (!canRestoreUserMessage(current, attachedImagesRef.current.length, pendingImageCountRef.current)) return;

      const restoredText = getUserMessageText(message);
      const restoredImages = draftImagesToAttachedImages(getUserMessageDraftImages(message));
      valueRef.current = restoredText;
      attachedImagesRef.current = restoredImages;
      setValue(restoredText);
      setAtQuery(null);
      setHistoryCycle(null);
      setAttachedImages((prev) => {
        prev.forEach(revokeImagePreview);
        return restoredImages;
      });
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      valueRef.current = combined;
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
      });
    },
    rekeyDraft(previousKey: string, nextKey: string) {
      if (previousKey === nextKey) return;
      if (draftKeyRef.current !== previousKey) {
        rekeyStoredDraft(previousKey, nextKey);
        return;
      }

      const currentDraft = {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      };
      const moved = rekeyStoredDraft(previousKey, nextKey, currentDraft) ?? { value: "", images: [] };
      const unchanged = moved.value === currentDraft.value
        && moved.images.length === currentDraft.images.length
        && moved.images.every((image, index) => (
          image.data === currentDraft.images[index]?.data
          && image.mimeType === currentDraft.images[index]?.mimeType
        ));
      draftKeyRef.current = nextKey;
      if (unchanged) return;

      const movedImages = draftImagesToAttachedImages(moved.images);
      valueRef.current = moved.value;
      attachedImagesRef.current = movedImages;
      setValue(moved.value);
      setAttachedImages((current) => {
        current.forEach(revokeImagePreview);
        return movedImages;
      });
      setAtQuery(null);
      setHistoryCycle(null);
    },
    restoreSubmission(text: string, images?: ChatDraftImage[], targetDraftKey?: string) {
      if (!text.trim() && !images?.length) return;

      // clearInput is queued before the submission handler runs. Compose with
      // that queued state so a fast rejection cannot observe stale DOM text and
      // then get overwritten by the clear.
      const currentDraftKey = draftKeyRef.current;
      const destinationDraftKey = targetDraftKey ?? currentDraftKey;
      const targetsCurrentComposer = destinationDraftKey === currentDraftKey;
      const storedDraft = !targetsCurrentComposer && destinationDraftKey
        ? getDraft(destinationDraftKey)
        : null;
      const restoredDraft = mergeRestoredSubmissionDraft(
        text,
        images,
        targetsCurrentComposer ? valueRef.current : (storedDraft?.value ?? ""),
        targetsCurrentComposer
          ? attachedImagesRef.current.map(imageToDraftImage)
          : (storedDraft?.images ?? []),
      );
      // The first optimistic message switches ChatWindow out of its empty-state
      // layout and remounts this component. Persist synchronously so recovery is
      // not lost if this instance is the one being unmounted.
      if (destinationDraftKey) setDraft(destinationDraftKey, restoredDraft);
      if (!targetsCurrentComposer) return;
      const restoredImages = images?.length
        ? [
            ...draftImagesToAttachedImages(images).slice(
              0,
              Math.max(0, MAX_ATTACHED_IMAGES - attachedImagesRef.current.length),
            ),
            ...attachedImagesRef.current,
          ].slice(0, MAX_ATTACHED_IMAGES)
        : attachedImagesRef.current;
      // Session promotion can rekey this composer before React flushes the
      // functional updates below, so update the imperative snapshot first.
      valueRef.current = restoredDraft.value;
      attachedImagesRef.current = restoredImages;
      setValue((current) => {
        const restored = mergeRestoredSubmissionText(text, current);
        valueRef.current = restored;
        return restored;
      });
      setAtQuery(null);
      setHistoryCycle(null);
      if (images?.length) {
        setAttachedImages((current) => {
          const available = Math.max(0, MAX_ATTACHED_IMAGES - current.length);
          const restored = draftImagesToAttachedImages(images)
            .slice(0, available);
          const next = restored.length > 0 ? [...restored, ...current] : current;
          attachedImagesRef.current = next;
          return next;
        });
      }
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      valueRef.current = newVal;
      setValue(newVal);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    const remaining = Math.max(
      0,
      MAX_ATTACHED_IMAGES - attachedImagesRef.current.length - pendingImageCountRef.current,
    );
    const imageFiles = files
      .filter((f) => f.type.startsWith("image/") && f.size <= MAX_ATTACHED_IMAGE_BYTES)
      .slice(0, remaining);
    if (!imageFiles.length) return;
    pendingImageCountRef.current += imageFiles.length;
    try {
      const newImages = await Promise.all(
        imageFiles.map(async (file) => ({
          ...await compressImageFile(file),
          previewUrl: URL.createObjectURL(file),
        }))
      );
      setAttachedImages((prev) => {
        const accepted = newImages.slice(0, Math.max(0, MAX_ATTACHED_IMAGES - prev.length));
        newImages.slice(accepted.length).forEach(revokeImagePreview);
        const next = [...prev, ...accepted];
        attachedImagesRef.current = next;
        return next;
      });
    } finally {
      pendingImageCountRef.current -= imageFiles.length;
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      attachedImagesRef.current = next;
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    attachedImagesRef.current = [];
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    valueRef.current = "";
    setValue("");
    setAtQuery(null);
    setHistoryCycle(null);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
    });
  }, [attachedImages, draftKey, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    const nextValue = draft?.value ?? "";
    const nextImages = draftImagesToAttachedImages(draft?.images);
    valueRef.current = nextValue;
    attachedImagesRef.current = nextImages;
    setValue(nextValue);
    setAtQuery(null);
    setHistoryCycle(null);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return nextImages;
    });
  }, [draftKey]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (value) ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, []);

  const runBuiltinCommand = useCallback(async (msg: string): Promise<boolean> => {
    if (attachedImages.length || !msg.startsWith("/") || !onBuiltinCommand) return false;
    const result = await onBuiltinCommand(msg);
    if (!result.handled) return false;
    if (!result.error && canClearBuiltinCommandInput(valueRef.current, attachedImagesRef.current.length, msg)) clearInput();
    return true;
  }, [attachedImages.length, clearInput, onBuiltinCommand]);

  const handleSend = useCallback(async () => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    onAudioUnlock?.();
    const builtinAllowed = !isStreaming || canRunBuiltinSlashCommandWhileStreaming(msg);
    if (builtinAllowed && await runBuiltinCommand(msg)) return;
    if (isStreaming) return;
    clearInput();
    onSend(msg, attachedImages.length ? attachedImages : undefined);
  }, [value, attachedImages, isStreaming, runBuiltinCommand, onSend, clearInput, onAudioUnlock]);

  const slashQuery = value.startsWith("/") && !/\s/.test(value.slice(1))
    ? value.slice(1).toLowerCase()
    : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const builtinCommands = isStreaming
      ? BUILTIN_SLASH_COMMANDS.filter((command) => command.availableWhileStreaming)
      : BUILTIN_SLASH_COMMANDS;
    const commands = [...builtinCommands, ...(slashCommands ?? [])];
    return [...commands]
      .filter((command) => {
        const name = command.name.toLowerCase();
        const description = getSlashDescription(command, t).toLowerCase();
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => {
        const rankDelta = slashMatchRank(a, slashQuery, t) - slashMatchRank(b, slashQuery, t);
        if (rankDelta !== 0) return rankDelta;
        return SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source]
          || TEXT_COLLATOR.compare(a.name, b.name);
      });
  })();

  const {
    commands: displayedSlashCommands,
    groups: groupedSlashCommands,
  } = buildSlashCommandLayout(filteredSlashCommands);

  const slashCommandCountLabel = filteredSlashCommands.length === 1
    ? t(slashQuery ? "chat.match" : "chat.command")
    : t(slashQuery ? "chat.matches" : "chat.commands", { count: filteredSlashCommands.length });
  const hasInputText = Boolean(value.trim());
  const canQueueStreamingMessage = hasInputText || attachedImages.length > 0;
  const hasStreamingActions = isStreaming && Boolean(onSteer || onFollowUp);
  const streamingSubmissionAction = getStreamingSubmissionAction(
    streamingAction,
    Boolean(onSteer),
    Boolean(onFollowUp),
  );

  useEffect(() => {
    setStreamingAction("steer");
    setStreamingActionMenuOpen(false);
  }, [hasStreamingActions]);

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    const pos = cursor ?? text.length;
    const query = extractAtQuery(text.slice(0, pos));
    setAtQuery(cwd || (query && isFilePathQuery(query.query)) ? query : null);
  }, [cwd]);

  const atQueryText = atQuery?.query ?? null;
  const atPathMode = atQueryText !== null && isFilePathQuery(atQueryText);
  const atLocalMatches: FileIndexEntry[] = React.useMemo(() => (
    !atPathMode && atQueryText !== null && fileIndex && fileIndex.cwd === cwd
      ? filterFileEntries(fileIndex.entries, atQueryText)
      : []
  ), [atPathMode, atQueryText, fileIndex, cwd]);

  // Explicit paths list one directory; large projects search their full index.
  const needsServerSearch = atPathMode || Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || atQueryText === null) return;
    const fetchCwd = cwd ?? "";
    const query = atQueryText;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ cwd: fetchCwd, q: query });
      fetch(`/api/${atPathMode ? "file-completion" : "file-index"}?${params}`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => {
          if (active) setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] });
        })
        .catch(() => {
          if (active) setAtServerResult({ cwd: fetchCwd, query, matches: [], failed: true });
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [needsServerSearch, atPathMode, atQueryText, cwd]);

  const serverResultInUse = needsServerSearch
    && atServerResult !== null
    && atServerResult.cwd === (cwd ?? "")
    && atServerResult.query === atQueryText
    && (atPathMode || !atServerResult.failed);
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Fetch the file index when the menu opens. The server caches per cwd for
  // ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || atPathMode || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`file index failed: ${res.status}`);
        return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
      })
      .then((data) => {
        setFileIndex({ cwd: fetchCwd, entries: buildEntriesFromFiles(data.files ?? []), truncated: !!data.truncated });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Leave any previous index in place; next open retries.
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, atPathMode, cwd]);

  const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
    if (!atQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    const before = value.slice(0, atQuery.start);
    let after = value.slice(cursor);
    // Completing inside a quoted token (@"my dir/… with the caret before the
    // closing quote): the replacement carries its own closing quote, so drop
    // the old one right after the caret (mirrors the TUI's applyCompletion).
    if (atQuery.quoted && after.startsWith('"')) {
      after = after.slice(1);
    }
    const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
    const newValue = before + insert.text + after;
    const newPos = before.length + insert.cursorOffset;
    setValue(newValue);
    // setValue alone does not fire onChange — re-derive the token here. Files
    // end with a space (token closes, menu hides); directories end with "/"
    // before the caret (token stays open for drill-down into the directory).
    setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
    });
  }, [atQuery, value]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  const applyHistoryInput = useCallback((text: string) => {
    setValue(text);
    setAtQuery(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
    });
  }, []);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    const nextValue = `/${command.name} `;
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
    });
  }, []);

  const sendQueued = useCallback((mode: StreamingAction) => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    onAudioUnlock?.();
    if (!attachedImages.length && onBuiltinCommand && canRunBuiltinSlashCommandWhileStreaming(msg)) {
      void runBuiltinCommand(msg);
      return;
    }
    const streamingBehavior = mode === "steer" ? "steer" : "followUp";
    if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
      clearInput();
      setStreamingAction("steer");
      setStreamingActionMenuOpen(false);
      onPromptWithStreamingBehavior(msg, streamingBehavior, attachedImages.length ? attachedImages : undefined);
      return;
    }
    const submit = mode === "steer" ? onSteer : onFollowUp;
    if (!submit) return;
    clearInput();
    setStreamingAction("steer");
    setStreamingActionMenuOpen(false);
    submit(msg, attachedImages.length ? attachedImages : undefined);
  }, [value, attachedImages, onBuiltinCommand, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock, runBuiltinCommand]);

  const selectStreamingAction = useCallback((action: StreamingAction) => {
    setStreamingAction(action);
    setStreamingActionMenuOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const anchoredMenuOpen = (slashMenuOpen && slashQuery !== null) || (atMenuOpen && atQuery !== null);
  useLayoutEffect(() => {
    if (!anchoredMenuOpen) {
      setAnchoredMenuMaxHeight(null);
      return;
    }
    const menu = anchoredMenuRef.current;
    if (!menu) return;

    let frameId: number | null = null;
    const update = () => {
      frameId = null;
      const next = getAnchoredMenuMaxHeight(
        menu.getBoundingClientRect().bottom,
        getVisibleTopBoundary(menu),
      );
      setAnchoredMenuMaxHeight((current) => (current === next ? current : next));
    };
    const schedule = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(update);
    };

    update();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [anchoredMenuOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const sendShortcut = e.key === "Enter" && !e.shiftKey && (!isMobile || e.ctrlKey || e.metaKey);
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (sendShortcut && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      // An active history cycle owns the arrows. Recalling a prompt that is a
      // bare "/command" re-derives slashQuery and reopens the palette, which
      // would otherwise swallow the next ArrowUp and strand the rest of the
      // history behind an Escape.
      if (historyCycle !== null && !isComposing && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const next = cycleInputHistory(inputHistory, historyCycle, e.key === "ArrowUp" ? "up" : "down");
        setHistoryCycle(next.cycle);
        applyHistoryInput(next.text);
        return;
      }

      // Skip while composing so IME candidate navigation is never intercepted,
      // and leave ArrowLeft/ArrowRight to the caret so a typo mid-command is
      // still fixable with the menu open.
      if (slashMenuOpen && slashQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex((i) => Math.min(Math.max(0, displayedSlashCommands.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        const selectedCommand = displayedSlashCommands[slashActiveIndex];
        if (e.key === "Tab" && selectedCommand) {
          e.preventDefault();
          applySlashCommand(selectedCommand);
          return;
        }
        if (sendShortcut && selectedCommand) {
          e.preventDefault();
          const canSubmitNow = !isStreaming
            || (selectedCommand.source === "builtin" && selectedCommand.availableWhileStreaming === true);
          if (canSubmitNow && isExactSlashCommand(value, selectedCommand)) {
            setSlashMenuOpen(false);
            void handleSend();
          } else {
            applySlashCommand(selectedCommand);
          }
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (e.key === "Escape" && !isComposing && streamingActionMenuOpen) {
        e.preventDefault();
        setStreamingActionMenuOpen(false);
        return;
      }

      // Start a cycle from an empty composer. Continuing one is handled higher
      // up, before the slash and @ menus.
      if (e.key === "ArrowUp" && !isComposing && !isStreaming && historyCycle === null
        && inputHistory.length > 0 && value.trim().length === 0) {
        e.preventDefault();
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        const next = cycleInputHistory(inputHistory, null, "up");
        setHistoryCycle(next.cycle);
        applyHistoryInput(next.text);
        return;
      }

      // Esc stops the agent when no slash/@/history menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }

      if (sendShortcut) {
        e.preventDefault();
        if (isStreaming && streamingSubmissionAction) {
          sendQueued(streamingSubmissionAction);
        } else {
          handleSend();
        }
      }
    },
    [historyCycle, isMobile, isStreaming, streamingSubmissionAction, streamingActionMenuOpen, onAbort, slashMenuOpen, slashQuery, displayedSlashCommands, slashActiveIndex, applySlashCommand, sendQueued, handleSend, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, inputHistory, applyHistoryInput, value]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    processImageFiles(files);
  }, [processImageFiles]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  // Lazy-load skill modes each time the slash palette opens, so changes made
  // in Settings are reflected on the next open. Failures degrade silently to
  // the unannotated palette.
  useEffect(() => {
    if (!slashMenuOpen || !cwd) return;
    const requestCwd = cwd;
    let cancelled = false;
    setSkillModeState({ cwd: requestCwd, values: {} });
    fetch(`/api/skills?cwd=${encodeURIComponent(requestCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`skills fetch failed: ${res.status}`);
        return res.json() as Promise<Partial<SkillsResponse>>;
      })
      .then((data) => {
        if (cancelled) return;
        const modes: Record<string, boolean> = {};
        for (const skill of data.skills ?? []) modes[skill.name] = skill.disableModelInvocation;
        setSkillModeState({ cwd: requestCwd, values: modes });
      })
      .catch(() => {
        if (!cancelled) setSkillModeState({ cwd: requestCwd, values: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [slashMenuOpen, cwd]);

  useEffect(() => {
    if (slashActiveIndex >= displayedSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, displayedSlashCommands.length - 1));
    }
  }, [displayedSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = displayedSlashCommands.length;
  }, [displayedSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelSelectorOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }));
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    }));
  })();

  const compactNeedsAttention = Boolean(compactWarning && !isCompacting);
  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactResultText = compactResult
    ? `${compactResult.reason && compactResult.reason !== "manual" ? `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)} ` : t("chat.compacted")} ${formatCompactCount(compactResult.tokensBefore)} -> ${formatCompactCount(compactResult.estimatedTokensAfter)} tokens (${t("chat.tokensSaved", { saved: formatCompactCount(compactSavedTokens) })})`
    : null;
  const thinkingDisplayLabel = (() => {
    const lvl = thinkingLevel ?? "auto";
    if (lvl === "auto" || !thinkingLevelMap) return lvl;
    return thinkingLevelMap[lvl] ?? lvl;
  })();
  // Both composer menus are native popovers: the browser owns light dismiss,
  // Escape and the top layer, and CSS anchor positioning keeps them pinned to
  // their triggers. Toggling is imperative because the elements stay mounted.
  useEffect(() => {
    const el = thinkingMenuRef.current;
    if (!el || typeof el.showPopover !== "function") return;
    if (thinkingDropdownOpen) { if (!el.matches(":popover-open")) el.showPopover(); }
    else if (el.matches(":popover-open")) el.hidePopover();
  }, [thinkingDropdownOpen]);

  useEffect(() => {
    const el = runActionMenuRef.current;
    if (!el || typeof el.showPopover !== "function") return;
    if (streamingActionMenuOpen) { if (!el.matches(":popover-open")) el.showPopover(); }
    else if (el.matches(":popover-open")) el.hidePopover();
  }, [streamingActionMenuOpen]);


  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "12px 16px 8px",
        paddingRight: isMobile ? 16 : 52, // desktop: 16px base + 36px for ChatMinimap alignment
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          processImageFiles(files);
          e.target.value = "";
        }}
      />
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <ModelErrorBanner error={modelError} />
        <ModelScopeWarningBanner warnings={modelScopeWarnings} />
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {((queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)) > 0 && (
          <div style={{
            marginBottom: 8,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg-panel)",
            padding: "5px 0",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "2px 8px 4px 10px",
            }}>
              <span style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}>
                {t("chat.queued", { count: (queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0) })}
              </span>
              {onRecallQueue && (
                <button
                  onClick={onRecallQueue}
                   title={t("chat.recallTitle")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    fontSize: 12,
                    color: "var(--text)",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    cursor: "pointer",
                    transition: "background 0.12s, border-color 0.12s",
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 45%, var(--border))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 14 4 9 9 4" />
                    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                  </svg>
                   {t("chat.recall")}
                </button>
              )}
            </div>
            {queuedMessages?.steering.map((text, i) => (
              <QueuedMessageRow key={`steer-${i}`} kind="steer" text={text} />
            ))}
            {queuedMessages?.followUp.map((text, i) => (
              <QueuedMessageRow key={`followup-${i}`} kind="follow-up" text={text} />
            ))}
          </div>
        )}
        {/* Retry banner */}
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
            borderRadius: 6, fontSize: 12, color: "rgba(180,130,0,0.9)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
             {t("chat.retrying", { attempt: retryInfo.attempt, max: retryInfo.maxAttempts })}{retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
          </div>
        )}
        {compactResultText && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.24)",
            borderRadius: 6, fontSize: 12, color: "rgba(5,150,105,0.95)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {compactResultText}
          </div>
        )}
        {compactError && (
          <div
            role="alert"
            style={{
              marginBottom: 8,
              padding: "7px 10px",
              background: "rgba(239,68,68,0.07)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 6,
              color: "var(--danger)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {compactError}
          </div>
        )}
        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl}
                  alt=""
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }}
                />
                <button
                  onClick={() => removeImage(i)}
                  style={{
                    position: "absolute", top: -4, right: -4,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "var(--bg-panel)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", padding: 0, color: "var(--text-muted)",
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input */}
        <div style={{ position: "relative", minWidth: 0 }}>
          {slashMenuOpen && slashQuery !== null && (
            <div
              ref={anchoredMenuRef}
              className="menu-surface menu-panel"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 120,
                overflow: "hidden",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                maxHeight: anchoredMenuMaxHeight === null ? "min(48vh, 400px)" : `min(48vh, 400px, ${anchoredMenuMaxHeight}px)`,
              }}
            >
              <div
                style={{
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 11,
                  color: "var(--text-dim)",
                  flexShrink: 0,
                }}
              >
                 <span>{slashCommandsLoading ? t("chat.loadingCommands") : t("chat.slashCommands", { label: slashCommandCountLabel })}</span>
                 <span style={{ fontFamily: "var(--font-mono)" }}>{t("chat.tabEnter")}</span>
              </div>
              <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: 4 }}>
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div style={{ padding: "2px 2px 4px", fontSize: 12, color: "var(--text-dim)" }}>
                     {t("chat.noCommands")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} style={{ marginBottom: 8 }}>
                      <div
                        className="menu-section-label"
                        style={{
                          position: "sticky",
                          top: -10,
                          zIndex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          background: "var(--bg)",
                        }}
                      >
                           <span>{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{group.items.length}</span>
                      </div>
                      <div>
                        {group.items.map(({ command, index }) => {
                          const active = index === slashActiveIndex;
                          const manual = isManualSkillCommand(command, skillModes);
                          return (
                            <button
                              key={`${command.source}:${command.name}`}
                              ref={(node) => {
                                slashItemRefs.current[index] = node;
                              }}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySlashCommand(command);
                              }}
                              onMouseEnter={() => setSlashActiveIndex(index)}
                              className="menu-item"
                              data-active={active}
                              style={{ alignItems: "baseline" }}
                            >
                              <span style={{
                                flexShrink: 0,
                                fontSize: 12.5,
                                fontFamily: "var(--font-mono)",
                                overflowWrap: "anywhere",
                              }}>
                                /{command.name}
                                {manual && (
                                  <span style={{
                                    marginLeft: 6,
                                    padding: "0 4px",
                                    border: "1px solid var(--border)",
                                    borderRadius: 3,
                                    fontSize: 9,
                                    color: "var(--text-muted)",
                                    whiteSpace: "nowrap",
                                  }}>
                                    {t("skills.mode.manual")}
                                  </span>
                                )}
                              </span>
                               {command.description && (
                                <span style={{
                                  minWidth: 0,
                                  flex: "1 1 auto",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  fontSize: 11,
                                  color: "var(--text-dim)",
                                }}>
                                   {getSlashDescription(command, t)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </div>
          )}
          {atMenuOpen && atQuery !== null && (() => {
            const indexLoading = atPathMode ? !serverResultInUse : fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
             const matchCountLabel = atMatches.length === 1 ? t("chat.match") : t("chat.matches", { count: atMatches.length });
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = !atPathMode && fileIndex?.truncated && !serverResultInUse
               ? (atQuery.query ? t("chat.searchingAll") : t("chat.indexTruncated"))
              : "";
            return (
              <div
                ref={anchoredMenuRef}
                className="menu-surface menu-panel"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: "calc(100% + 8px)",
                  zIndex: 120,
                  overflow: "hidden",
                  maxHeight: anchoredMenuMaxHeight === null ? "min(48vh, 400px)" : `min(48vh, 400px, ${anchoredMenuMaxHeight}px)`,
                }}
              >
                <div
                  style={{
                    padding: "8px 10px",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  <span>
                    {indexLoading
                       ? t("chat.loadingFiles")
                       : t("chat.files", { label: matchCountLabel, hint: truncatedHint })}
                  </span>
                   <span style={{ fontFamily: "var(--font-mono)" }}>{t("chat.tabEnter")}</span>
                </div>
                <div style={{ maxHeight: "calc(min(48vh, 400px) - 34px)", overflowY: "auto", padding: 4 }}>
                  {!indexLoading && atMatches.length === 0 ? (
                    <div style={{ padding: "6px 8px", fontSize: 12, color: "var(--text-dim)" }}>
                       {atPathMode && serverResultInUse && atServerResult.failed ? t("chat.cannotListFiles")
                         : needsServerSearch && !serverResultInUse ? t("chat.searching") : t("chat.noMatchingFiles")}
                    </div>
                  ) : (
                    atMatches.map((entry, index) => {
                      const active = index === atActiveIndex;
                      const name = entry.path.split(/[\\/]/).pop() ?? entry.path;
                      const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
                      return (
                        <button
                          key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                          ref={(node) => {
                            atItemRefs.current[index] = node;
                          }}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyAtCompletion(entry);
                          }}
                          onMouseEnter={() => setAtActiveIndex(index)}
                          className="menu-item"
                          data-active={active}
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                            {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                          </span>
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dirPrefix && <span style={{ color: "var(--text-dim)" }}>{dirPrefix}</span>}
                            {name}
                            {entry.isDir && <span style={{ color: "var(--text-dim)" }}>/</span>}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
          <div
            style={{
              minWidth: 0,
              display: "flex",
              gap: 8,
              alignItems: "center",
              background: "var(--bg)",
              border: `1px solid ${bashMode ? "var(--tool-bg)" : isStreaming && (onSteer || onFollowUp)
                ? streamingSubmissionAction === "followup" ? "rgba(129,140,248,0.4)" : "rgba(234,179,8,0.4)"
                : "color-mix(in srgb, var(--border) 70%, transparent)"}`,
              borderRadius: 14,
              padding: "10px 10px 10px 14px",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
              transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
            } as React.CSSProperties}
          >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              valueRef.current = e.target.value;
              setValue(e.target.value);
              setHistoryCycle(null);
              updateAtQuery(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onInput={handleInput}
            onPaste={handlePaste}
            placeholder={
              isStreaming && (onSteer || onFollowUp)
                ? t("chat.steerPlaceholder")
                : isStreaming ? t("chat.agentPlaceholder")
                : t("chat.messagePlaceholder")
            }
            rows={1}
            style={{
              flex: 1,
              minWidth: 0,
              width: "100%",
              background: "none",
              border: "none",
              outline: "none",
              resize: "none",
              color: "var(--text)",
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: "inherit",
              minHeight: 24,
              maxHeight: 200,
              overflow: "auto",
            }}
          />

          <div
            className="composer-action-slot"
            style={{ width: 72, minWidth: 72, height: 34, flexShrink: 0, alignSelf: "flex-end" }}
          >
            {hasStreamingActions && streamingSubmissionAction ? (
              <div
                onKeyDown={(e) => {
                  if (e.key !== "Escape" || !streamingActionMenuOpen) return;
                  e.preventDefault();
                  setStreamingActionMenuOpen(false);
                  textareaRef.current?.focus();
                }}
                style={{ position: "relative", display: "flex", width: "100%", height: "100%" }}
              >
                <button
                  type="button"
                  className="composer-action-primary"
                  aria-label={t(streamingSubmissionAction === "steer" ? "chat.steer" : "chat.followUp")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => sendQueued(streamingSubmissionAction)}
                  disabled={!canQueueStreamingMessage}
                  title={t(streamingSubmissionAction === "steer" ? "chat.steerTitle" : "chat.followUpTitle")}
                  style={{
                    minWidth: 0, flex: 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: "7px 8px",
                    background: canQueueStreamingMessage
                      ? streamingSubmissionAction === "steer" ? "rgba(234,179,8,0.12)" : "rgba(129,140,248,0.12)"
                      : "none",
                    border: `1px solid ${streamingSubmissionAction === "steer" ? "rgba(234,179,8,0.35)" : "rgba(129,140,248,0.35)"}`,
                    borderRight: "none",
                    borderRadius: "8px 0 0 8px",
                    color: canQueueStreamingMessage
                      ? streamingSubmissionAction === "steer" ? "rgba(180,130,0,1)" : "rgba(99,102,241,1)"
                      : "var(--text-dim)",
                    cursor: canQueueStreamingMessage ? "pointer" : "not-allowed",
                    fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
                    whiteSpace: "nowrap",
                    transition: "background 0.12s",
                  }}
                >
                  {streamingSubmissionAction === "steer" ? (
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 1 L9 5 L5 9" /><line x1="1" y1="5" x2="9" y2="5" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="1" x2="5" y2="6" /><polyline points="2.5 3.5 5 1 7.5 3.5" />
                      <line x1="2" y1="9" x2="8" y2="9" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  className="composer-action-menu-toggle"
                  aria-label={t("chat.selectRunAction")}
                  aria-expanded={streamingActionMenuOpen}
                  popoverTarget={runActionMenuId}
                  onMouseDown={(e) => e.preventDefault()}
                  style={{
                    width: 30, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: 0,
                    background: streamingSubmissionAction === "steer" ? "rgba(234,179,8,0.12)" : "rgba(129,140,248,0.12)",
                    border: `1px solid ${streamingSubmissionAction === "steer" ? "rgba(234,179,8,0.35)" : "rgba(129,140,248,0.35)"}`,
                    borderRadius: "0 8px 8px 0",
                    color: streamingSubmissionAction === "steer" ? "rgba(180,130,0,1)" : "rgba(99,102,241,1)",
                    cursor: "pointer",
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="2 3.5 5 6.5 8 3.5" />
                  </svg>
                </button>
                <div
                  ref={runActionMenuRef}
                  id={runActionMenuId}
                  popover="auto"
                  className="anchored-menu menu-surface opens-up menu-composer-run-action"
                  onToggle={(e) => setStreamingActionMenuOpen((e as unknown as { newState?: string }).newState === "open")}
                  role="group"
                  aria-label={t("chat.selectRunAction")}
                  style={{
                    zIndex: 130,
                    width: "max-content", minWidth: "anchor-size(width)",
                  }}
                >
                  {(["steer", "followup"] as const)
                    .filter((action) => action === "steer" ? onSteer : onFollowUp)
                    .map((action) => (
                    <button
                      key={action}
                      type="button"
                      aria-pressed={streamingSubmissionAction === action}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectStreamingAction(action)}
                      className="menu-item"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      <span aria-hidden="true" style={{ width: 10 }}>
                        {streamingSubmissionAction === action ? "✓" : ""}
                      </span>
                      {t(action === "steer" ? "chat.steer" : "chat.followUp")}
                    </button>
                  ))}
                </div>
              </div>
            ) : !isStreaming ? (
              <button
                type="button"
                className="composer-action-primary"
                aria-label={t("chat.send")}
                title={t("chat.send")}
                onClick={handleSend}
                disabled={!value.trim() && !attachedImages.length}
                style={{
                  width: "100%", height: "100%",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "7px 14px",
                  background: (value.trim() || attachedImages.length) ? "var(--accent)" : "var(--bg-panel)",
                  border: "none",
                  borderRadius: 8,
                  color: (value.trim() || attachedImages.length) ? "#fff" : "var(--text-dim)",
                  cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed",
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  boxShadow: (value.trim() || attachedImages.length) ? "0 1px 3px rgba(37,99,235,0.25)" : "none",
                  transition: "background 0.15s, box-shadow 0.15s",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="2" y1="7" x2="11" y2="7" />
                  <polyline points="7.5 3 12 7 7.5 11" />
                </svg>
              </button>
            ) : null}
          </div>
          </div>
        </div>

        {/* Bash mode status label */}
        {bashMode && (
          <div style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", lineHeight: "calc(1 / 0.75)", color: bashExcluded ? "var(--text-muted)" : "var(--accent)", marginTop: 4 }}>
             {t("chat.shell")} · {bashExcluded ? t("chat.outputLocal") : t("chat.outputModel")}
          </div>
        )}

        {/* Bottom bar: settings on the left, immediate actions on the right */}
        <div style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          {/* LEFT: composer settings */}
          <div className="composer-settings-group" style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 2 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
             title={t("chat.attachImage")}
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, padding: 0,
                background: "none", border: "none",
                borderRadius: 9,
                color: attachedImages.length ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
                opacity: 1,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text-muted)";
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            {/* Model selector - visible always, disabled while the session or switch is busy */}
            {(modelOptions.length > 0 || model || modelError) && onModelChange && (
              <ModelSelector
                options={modelOptions}
                value={model}
                onChange={onModelChange}
                disabled={isStreaming}
                busy={modelSwitching}
                isAutoSelection={isAutoModelSelection}
              />
            )}
            {!isStreaming && onThinkingLevelChange && (
              <div style={{ position: "relative" }}>
                <button
                  className="anchor-composer-reasoning"
                  popoverTarget={thinkingMenuId}
                  disabled={isStreaming}
                   title={t("chat.changeReasoning", { level: thinkingDisplayLabel })}
                   aria-label={t("chat.changeReasoningLabel")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: isMobile ? "0 6px" : "8px 12px",
                    width: isMobile ? "auto" : undefined,
                    height: 32,
                    background: thinkingDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = thinkingDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
                    <line x1="7" y1="18" x2="12" y2="18" />
                    <line x1="8" y1="21" x2="11" y2="21" />
                  </svg>
                  {!isMobile && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
                </button>
                <div
                  ref={thinkingMenuRef}
                  id={thinkingMenuId}
                  popover="auto"
                  className="anchored-menu menu-surface opens-up menu-composer-reasoning"
                  onToggle={(e) => setThinkingDropdownOpen((e as unknown as { newState?: string }).newState === "open")}
                  style={{
                    zIndex: 100,
                    overflow: "hidden", minWidth: 180,
                  }}>
                    {THINKING_LEVELS.filter((lvl) => {
                      if (!availableThinkingLevels) return true;
                      if (lvl === "auto") return true;
                      return availableThinkingLevels.includes(lvl);
                    }).map((lvl) => {
                      const isActive = (thinkingLevel ?? "auto") === lvl;
                       const desc = t(THINKING_LEVEL_DESC_KEYS[lvl]);
                      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                      const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl;
                      const showOriginal = mappedVal != null && mappedVal !== lvl;
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
                          className="menu-item"
                          aria-pressed={isActive}
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {isActive
                            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                            : <span style={{ width: 10, flexShrink: 0 }} />}
                          <span style={{ flex: 1 }}>
                            {displayLabel}
                            {showOriginal && <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({lvl})</span>}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {!isMobile && <div style={{ flex: 1 }} />}

          <div className="composer-immediate-actions" style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            marginLeft: "auto",
          }}>
            {!isStreaming && onCompact && (
              <div>
                <button
                  onClick={isCompacting ? onAbortCompaction : onCompact}
                  disabled={isStreaming && !isCompacting}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: isMobile ? "0 6px" : "8px 12px",
                    width: isMobile ? "auto" : undefined,
                    height: 32,
                    background: isCompacting ? "rgba(239,68,68,0.08)" : compactNeedsAttention ? "rgba(34,197,94,0.08)" : "none",
                    border: `1px solid ${compactNeedsAttention ? "rgba(34,197,94,0.3)" : "transparent"}`,
                    borderRadius: 9,
                    color: isCompacting ? "var(--danger)" : compactNeedsAttention ? "var(--success)" : "var(--text-muted)",
                    cursor: (isStreaming && !isCompacting) ? "not-allowed" : "pointer",
                    fontSize: 12, fontWeight: compactNeedsAttention ? 600 : 400, opacity: (isStreaming && !isCompacting) ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming && !isCompacting) return;
                    e.currentTarget.style.background = isCompacting ? "rgba(239,68,68,0.16)" : compactNeedsAttention ? "rgba(34,197,94,0.16)" : "var(--bg-hover)";
                    e.currentTarget.style.color = isCompacting ? "var(--danger)" : compactNeedsAttention ? "var(--success)" : "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isCompacting ? "rgba(239,68,68,0.08)" : compactNeedsAttention ? "rgba(34,197,94,0.08)" : "none";
                    e.currentTarget.style.color = isCompacting ? "var(--danger)" : compactNeedsAttention ? "var(--success)" : "var(--text-muted)";
                  }}
                   title={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
                   aria-label={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
                >
                  {isCompacting ? (
                    <><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" /></svg>{!isMobile && <span style={{ whiteSpace: "nowrap" }}>{t("chat.compacting")}</span>}</>
                  ) : (
                    <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                      <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
                    </svg>{!isMobile && <span style={{ whiteSpace: "nowrap" }}>{t("chat.compact")}</span>}</>
                  )}
                </button>
              </div>
            )}

            {isStreaming && (
              <button
                onClick={onAbort}
                 title={t("chat.stopAgent")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 14px",
                  height: 32,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 9,
                  color: "var(--danger)",
                  cursor: "pointer",
                  fontSize: 12, fontWeight: 600,
                  whiteSpace: "nowrap", letterSpacing: "-0.01em",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.16)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
                </svg>
                 {t("chat.stop")}
              </button>
            )}

          </div>
        </div>
      </div>
    </div>
  );
});
