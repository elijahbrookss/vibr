import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import UploadPane from "./components/UploadPane";
import FontEditor from "./components/FontEditor";
import LyricsPanel from "./components/LyricsPanel";
import TrimModal from "./components/TrimModal";
import VideoPreview from "./components/VideoPreview";
import EmptyState from "./components/EmptyState";
import "./App.css";

const log = (...args) => console.debug("[LyricPortal]", ...args);
const TRIM_LIMITS = { min: 3, max: 180 };
const MAX_WORDS_PER_CHUNK = 4;
const MAX_GAP_BETWEEN_WORDS = 0.3;
const MIN_WORD_DURATION = 0.015;
const INSERT_PADDING = 0.02;
const OVERLAP_EPSILON = 0.001;
const hasAdjustments = (adjustments = {}) =>
  Boolean(
    (adjustments.shifted && adjustments.shifted.length) ||
      (adjustments.batched && adjustments.batched.length) ||
      (adjustments.dropped && adjustments.dropped.length)
  );
const DEFAULT_FONT_OPTIONS = [
  { label: "Inter", value: "Inter", family: "Inter" },
  { label: "Roboto", value: "Roboto", family: "Roboto" },
  { label: "Montserrat", value: "Montserrat", family: "Montserrat" },
  { label: "Space Grotesk", value: "Space Grotesk", family: "Space Grotesk" },
  { label: "Avenir", value: "Avenir", family: "Avenir" },
];
const APP_STATES = {
  idle: "idle",
  uploaded: "uploaded",
  trimming: "trimming",
  fontConfig: "fontConfig",
  rendering: "rendering",
  ready: "ready",
  // videoClipSelect can slot between fontConfig and rendering without refactors
};
const RENDER_MESSAGES = [
  "Uploading audio to the studio",
  "Analyzing waveform and timing",
  "Convincing your hi-hats to chill out",
  "Splitting lyrics into four-word chunks",
  "Teaching your lyrics how to dance",
  "Syncing text with the beat",
  "Reminding the bass it’s not the main character",
  "Rendering your lyric video",
  "Politely arguing with the tempo",
  "Asking the snare if it’s okay to be this loud",
];

const sortWordsByTime = (words) =>
  [...words].sort((a, b) => {
    if (a.start === b.start) return a.end - b.end;
    return a.start - b.start;
  });

const validateWordSequence = (words) => {
  const ordered = sortWordsByTime(words);
  const adjusted = [];
  const adjustments = { shifted: [], batched: [], dropped: [] };

  let idx = 0;
  while (idx < ordered.length) {
    const word = ordered[idx];
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) {
      return { valid: false, message: "Start and end times must be numbers.", errorWordId: word.id };
    }
    if (word.start < 0) {
      return { valid: false, message: "Word timings cannot be negative.", errorWordId: word.id };
    }
    const durationMs = Math.round((word.end - word.start) * 1000);
    const duration = word.end - word.start;
    if (duration < MIN_WORD_DURATION) {
      return {
        valid: false,
        message: `Each word needs at least 15ms of duration (got ${durationMs}ms).`,
        errorWordId: word.id,
      };
    }

    if (adjusted.length === 0) {
      adjusted.push(word);
      idx += 1;
      continue;
    }

    const previous = adjusted[adjusted.length - 1];
    if (word.start >= previous.end - OVERLAP_EPSILON) {
      adjusted.push(word);
      idx += 1;
      continue;
    }

    const candidateStart = previous.end + OVERLAP_EPSILON;
    const candidateEnd = candidateStart + duration;
    const nextStart = idx + 1 < ordered.length ? ordered[idx + 1].start : null;
    const fitsAfterShift = !nextStart || candidateEnd <= nextStart - OVERLAP_EPSILON;

    if (fitsAfterShift) {
      adjustments.shifted.push({
        id: word.id,
        text: word.text,
        from: { start: word.start, end: word.end },
        to: { start: candidateStart, end: candidateEnd },
      });
      adjusted.push({ ...word, start: candidateStart, end: candidateEnd });
      idx += 1;
      continue;
    }

    const group = [previous, word];
    adjusted.pop();
    let groupStart = Math.min(previous.start, word.start);
    let groupEnd = Math.max(previous.end, word.end);
    let nextIdx = idx + 1;
    while (nextIdx < ordered.length && group.length < 4) {
      const candidate = ordered[nextIdx];
      if (candidate.start <= groupEnd + OVERLAP_EPSILON) {
        group.push(candidate);
        groupEnd = Math.max(groupEnd, candidate.end);
        nextIdx += 1;
      } else {
        break;
      }
    }

    if (group.length <= 4) {
      const merged = {
        id: `batch-${group.map((w) => w.id).join("+")}`,
        text: group.map((w) => w.text).join(" "),
        start: groupStart,
        end: groupEnd,
      };
      adjustments.batched.push({
        ids: group.map((w) => w.id),
        text: merged.text,
        start: merged.start,
        end: merged.end,
      });
      adjusted.push(merged);
      idx = nextIdx;
      continue;
    }

    adjustments.dropped.push({ id: word.id, text: word.text, start: word.start, end: word.end, reason: "overlap_unresolved" });
    adjusted.push(previous);
    idx += 1;
  }

  let prevEnd = 0;
  for (let i = 0; i < adjusted.length; i += 1) {
    const w = adjusted[i];
    if (w.start < prevEnd - OVERLAP_EPSILON) {
      const overlapMs = Math.round((prevEnd - w.start) * 1000);
      return {
        valid: false,
        message: `${w.text || w.id} overlaps the previous word by ${overlapMs}ms (start ${w.start.toFixed(3)}s, end ${w.end.toFixed(
          3,
        )}s, previous end ${prevEnd.toFixed(3)}s).`,
        errorWordId: w.id,
      };
    }
    prevEnd = Math.max(prevEnd, w.end);
  }

  return { valid: true, ordered: adjusted, adjustments };
};

const chunkWords = (words) => {
  const ordered = sortWordsByTime(words);
  const chunks = [];
  let current = [];
  ordered.forEach((word) => {
    if (current.length === 0) {
      current.push(word);
      return;
    }
    const gap = word.start - current[current.length - 1].end;
    if (gap > MAX_GAP_BETWEEN_WORDS || current.length >= MAX_WORDS_PER_CHUNK) {
      chunks.push(current);
      current = [word];
    } else {
      current.push(word);
    }
  });
  if (current.length) {
    chunks.push(current);
  }
  return chunks.map((wordsInChunk) => ({
    text: wordsInChunk.map((w) => w.text).join(" "),
    start: wordsInChunk[0]?.start ?? 0,
    end: wordsInChunk[wordsInChunk.length - 1]?.end ?? 0,
    words: wordsInChunk,
  }));
};

function App() {
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [trimModalOpen, setTrimModalOpen] = useState(false);
  const [modalRange, setModalRange] = useState({ start: 0, end: 0 });
  const [trimPreviewUrl, setTrimPreviewUrl] = useState("");
  const [audioDuration, setAudioDuration] = useState(0);
  const [trimSelection, setTrimSelection] = useState({ start: 0, end: 0, active: false });
  const [waveformPoints, setWaveformPoints] = useState([]);
  const [fontSettings, setFontSettings] = useState({
    size: 70,
    family: "Inter",
    color: "#ffffff",
    weight: 600,
    path: null,
    url: null,
    option: "Inter",
    isCustom: false,
  });
  const [fontOptions, setFontOptions] = useState(DEFAULT_FONT_OPTIONS);
  const [fontUploading, setFontUploading] = useState(false);
  const [editedWords, setEditedWords] = useState([]);
  const [outputId, setOutputId] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTrim, setVideoTrim] = useState({ start: 0, end: 0 });
  const [appState, setAppState] = useState(APP_STATES.idle);
  const [renderMessageIndex, setRenderMessageIndex] = useState(0);
  const [wordError, setWordError] = useState("");
  const [rowErrors, setRowErrors] = useState({});
  const [activeWordId, setActiveWordId] = useState("");
  const [playbackTime, setPlaybackTime] = useState(0);
  const [clientLogs, setClientLogs] = useState([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const renderDurationRef = useRef([]);
  const renderTimerRef = useRef(null);
  const videoRef = useRef(null);
  const loadedFontsRef = useRef(new Set());

  const orderedWords = useMemo(() => sortWordsByTime(editedWords), [editedWords]);
  const previewChunks = useMemo(() => chunkWords(orderedWords), [orderedWords]);
  const visibleChunks = useMemo(() => previewChunks.slice(0, 6), [previewChunks]);
  const hasResult = Boolean(result);
  const isRendering = appState === APP_STATES.rendering;
  const isReady = appState === APP_STATES.ready;
  const showTypeface = appState === APP_STATES.fontConfig || isReady || isRendering;
  const showPreview = isReady;
  const showLyrics = isReady;

  const appendLog = useCallback((level, message, meta = null) => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      level,
      message,
      meta,
      at: new Date().toISOString(),
    };
    log(level, message, meta ?? "");
    setClientLogs((prev) => [entry, ...prev].slice(0, 40));
  }, []);

  const parseApiError = useCallback(async (response) => {
    let bodyMessage = "";
    try {
      const payload = await response.json();
      bodyMessage = payload?.detail || payload?.error || payload?.message || "";
    } catch (err) {
      log("parse error body failed", err);
    }
    const fallback = `${response.status} ${response.statusText || ""}`.trim();
    return bodyMessage || fallback || "Request failed";
  }, []);

  useEffect(() => {
    if (!isRendering) {
      setRenderMessageIndex(0);
      renderDurationRef.current = [];
      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
      return undefined;
    }

    const randomDuration = () => {
      const u = Math.random();
      return 3 + Math.round(22 * (1 - u * u));
    };

    renderDurationRef.current = RENDER_MESSAGES.map(() => randomDuration());
    setRenderMessageIndex(0);

    const scheduleNext = (idx) => {
      const durations = renderDurationRef.current;
      const currentDuration = durations[idx] ?? 5;
      renderTimerRef.current = setTimeout(() => {
        setRenderMessageIndex((prev) => (prev + 1) % RENDER_MESSAGES.length);
        scheduleNext((idx + 1) % RENDER_MESSAGES.length);
      }, currentDuration * 1000);
    };

    scheduleNext(0);

    return () => {
      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
    };
  }, [isRendering]);

  useEffect(() => {
    if (!fontSettings.url || !fontSettings.family) return undefined;
    const key = `${fontSettings.family}:${fontSettings.url}`;
    if (loadedFontsRef.current.has(key)) return undefined;
    let cancelled = false;
    const face = new FontFace(fontSettings.family, `url(${fontSettings.url})`);
    face
      .load()
      .then((loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        loadedFontsRef.current.add(key);
        appendLog("info", "Loaded custom font for preview", { family: fontSettings.family });
      })
      .catch((err) => {
        if (!cancelled) {
          appendLog("warn", "Failed to load custom font", { message: err?.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fontSettings.family, fontSettings.url, appendLog]);

  useEffect(() => {
    const node = videoRef.current;
    if (!node) {
      setActiveWordId("");
      setPlaybackTime(0);
      return undefined;
    }
    const handleTimeUpdate = () => {
      const currentTime = node.currentTime ?? 0;
      const active = orderedWords.find((word) => currentTime >= word.start && currentTime < word.end);
      setPlaybackTime(currentTime);
      setActiveWordId(active?.id ?? "");
    };
    node.addEventListener("timeupdate", handleTimeUpdate);
    return () => node.removeEventListener("timeupdate", handleTimeUpdate);
  }, [orderedWords]);

  useEffect(() => {
    return () => {
      if (trimPreviewUrl) URL.revokeObjectURL(trimPreviewUrl);
    };
  }, [trimPreviewUrl]);

  const processAudioForTrim = useCallback(async (selectedFile) => {
    if (!selectedFile) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error("AudioContext unavailable");
      const audioCtx = new AudioCtx();
      const arrayBuffer = await selectedFile.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      const channelData = decoded.getChannelData(0);
      const samples = 160;
      const blockSize = Math.floor(channelData.length / samples) || 1;
      const nextPoints = Array.from({ length: samples }, (_, index) => {
        let sum = 0;
        for (let i = 0; i < blockSize; i += 1) {
          const value = channelData[index * blockSize + i] ?? 0;
          sum += Math.abs(value);
        }
        return sum / blockSize;
      });
      const clippedDuration = Math.min(decoded.duration, TRIM_LIMITS.max);
      setWaveformPoints(nextPoints);
      setAudioDuration(decoded.duration);
      setModalRange({ start: 0, end: clippedDuration });
      setTrimSelection({ start: 0, end: clippedDuration, active: false });
      await audioCtx.close();
    } catch (err) {
      log("waveform error", err);
      appendLog("error", "Waveform extraction failed", { reason: err?.message });
      setWaveformPoints([]);
      setAudioDuration(0);
      setModalRange({ start: 0, end: 0 });
    }
  }, [appendLog]);

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    setResult(null);
    setStatus("");
    setError("");
    setWordError("");
    if (trimPreviewUrl) {
      URL.revokeObjectURL(trimPreviewUrl);
      setTrimPreviewUrl("");
    }
    if (selectedFile) {
      appendLog("info", "Selected audio file", { name: selectedFile.name, size: selectedFile.size });
      const nextUrl = URL.createObjectURL(selectedFile);
      setTrimPreviewUrl(nextUrl);
      setTrimModalOpen(false);
      setAppState(APP_STATES.uploaded);
      processAudioForTrim(selectedFile);
    } else {
      setTrimModalOpen(false);
      setWaveformPoints([]);
      setTrimSelection({ start: 0, end: 0, active: false });
      setAppState(APP_STATES.idle);
    }
  };

  const upsertFontOption = useCallback((option) => {
    setFontOptions((prev) => {
      const existingIndex = prev.findIndex((entry) => entry.value === option.value);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = { ...next[existingIndex], ...option };
        return next;
      }
      return [...prev, option];
    });
  }, []);

  useEffect(() => {
    if (!result) {
      setEditedWords([]);
      setOutputId("");
      setVideoDuration(0);
      setVideoTrim({ start: 0, end: 0 });
      setWordError("");
      setRowErrors({});
      setActiveWordId("");
      setClientLogs([]);
      if (!file) {
        setAppState(APP_STATES.idle);
      }
      return;
    }
    const duration = result.metadata?.video_duration ?? 0;
    setEditedWords(result.words ?? []);
    setOutputId(result.output_id ?? "");
    setVideoDuration(duration);
    setVideoTrim({
      start: result.metadata?.video_trim?.start ?? 0,
      end: result.metadata?.video_trim?.end ?? duration,
    });
    const metaFontPath = result.metadata?.font?.path || null;
    const normalizedFontUrl = metaFontPath
      ? metaFontPath.startsWith("/static/")
        ? metaFontPath
        : `/static/${metaFontPath}`
      : null;
    if (metaFontPath) {
      upsertFontOption({
        label: `${result.metadata?.font?.family || "Custom font"} (uploaded)`,
        value: metaFontPath,
        family: result.metadata?.font?.family || "Custom font",
        path: metaFontPath,
        url: normalizedFontUrl,
        custom: true,
      });
    }
    setFontSettings({
      size: result.metadata?.font?.size ?? 70,
      family: result.metadata?.font?.family ?? "Inter",
      color: result.metadata?.font?.color ?? "#ffffff",
      weight: result.metadata?.font?.weight ?? 600,
      path: metaFontPath,
      url: normalizedFontUrl,
      option: metaFontPath || result.metadata?.font?.family || "Inter",
      isCustom: Boolean(metaFontPath),
    });
    setAppState(APP_STATES.ready);
  }, [result, upsertFontOption, file]);

  const handleFontUpload = useCallback(
    async (fontFile) => {
      if (!fontFile) return;
      setFontUploading(true);
      const formData = new FormData();
      formData.append("file", fontFile);
      appendLog("info", "Uploading custom font", { name: fontFile.name, size: fontFile.size });
      try {
        const response = await fetch("/api/fonts", { method: "POST", body: formData });
        if (!response.ok) {
          const message = await parseApiError(response);
          throw new Error(message);
        }
        const payload = await response.json();
        const option = {
          value: payload.font_path || payload.font_id,
          label: `${payload.family} (uploaded)`,
          family: payload.family,
          path: payload.font_path,
          url: payload.font_url,
          custom: true,
        };
        upsertFontOption(option);
        setFontSettings((prev) => ({
          ...prev,
          family: option.family,
          option: option.value,
          path: option.path,
          url: option.url,
          isCustom: true,
        }));
        appendLog("success", "Font uploaded", { fontId: payload.font_id, family: payload.family });
      } catch (err) {
        const message = err?.message || "Font upload failed";
        setError(message);
        appendLog("error", "Font upload failed", { message });
      } finally {
        setFontUploading(false);
      }
    },
    [appendLog, parseApiError, upsertFontOption]
  );

  const handleSubmit = async () => {
    if (!file) {
      setError("Select an audio file first.");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("font_family", fontSettings.family);
    formData.append("font_size", fontSettings.size);
    formData.append("font_color", fontSettings.color);
    formData.append("font_weight", fontSettings.weight);
    if (fontSettings.path) {
      formData.append("font_custom_path", fontSettings.path);
    }
    if (trimSelection.active) {
      formData.append("trim_start", trimSelection.start.toString());
      formData.append("trim_end", trimSelection.end.toString());
    }
    appendLog("info", "Starting render request", {
      endpoint: "/api/process",
      file: file.name,
      trim: trimSelection.active ? `${trimSelection.start}-${trimSelection.end}` : "full",
    });
    setLoading(true);
    setAppState(APP_STATES.rendering);
    setStatus("Uploading audio...");
    setError("");
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const message = await parseApiError(response);
        appendLog("error", "Render request rejected", { message });
        throw new Error(message);
      }
      const payload = await response.json();
      setResult(payload);
      setStatus("Lyric video ready!");
      appendLog("success", "Render completed", { outputId: payload?.output_id });
      setAppState(APP_STATES.ready);
    } catch (err) {
      appendLog("error", "Render failed", { message: err?.message });
      setError(err.message || "Upload failed");
      setStatus("");
      setAppState(APP_STATES.fontConfig);
    } finally {
      setLoading(false);
    }
  };
  const flagRowError = useCallback((wordId, message) => {
    if (!wordId) {
      setWordError(message);
      return;
    }
    setRowErrors((prev) => ({ ...prev, [wordId]: message }));
    setTimeout(() => {
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[wordId];
        return next;
      });
    }, 2000);
  }, []);

  const updateWordsSafely = useCallback(
    (updater) => {
      setEditedWords((prev) => {
        const next = updater(prev);
        const validation = validateWordSequence(next);
        if (!validation.valid) {
          setWordError(validation.message);
          appendLog("warn", "Word validation failed", { message: validation.message, wordId: validation.errorWordId });
          if (validation.errorWordId) {
            flagRowError(validation.errorWordId, validation.message);
          }
          return prev;
        }
        setWordError("");
        if (hasAdjustments(validation.adjustments)) {
          appendLog("warn", "Auto-resolved overlapping words", { adjustments: validation.adjustments });
        }
        if (validation.errorWordId) {
          setRowErrors((prev) => {
            const nextErrors = { ...prev };
            delete nextErrors[validation.errorWordId];
            return nextErrors;
          });
        }
        return validation.ordered;
      });
    },
    [flagRowError, appendLog]
  );

  const handleWordTextChange = (id, text) => {
    updateWordsSafely((prev) => prev.map((word) => (word.id === id ? { ...word, text } : word)));
    appendLog("info", "Edited word text", { wordId: id, text });
  };

  const handleWordTimingChange = (id, key, rawValue) => {
    const numeric = Number.parseFloat(rawValue);
    if (!Number.isFinite(numeric)) {
      setWordError("Enter a numeric timestamp in seconds.");
      flagRowError(id, "Enter a numeric timestamp in seconds.");
      appendLog("warn", "Rejected non-numeric timestamp", { wordId: id, rawValue });
      return;
    }
    updateWordsSafely((prev) => prev.map((word) => (word.id === id ? { ...word, [key]: numeric } : word)));
    appendLog("info", "Updated word timing", { wordId: id, key, value: numeric });
  };

  const handleInsertAfter = (id) => {
    updateWordsSafely((prev) => {
      const ordered = sortWordsByTime(prev);
      const index = ordered.findIndex((word) => word.id === id);
      if (index === -1 || index === ordered.length - 1) {
        setWordError("Select a gap between two words to insert a new one.");
        flagRowError(id, "Select a gap between two words to insert a new one.");
        appendLog("warn", "Insert attempted without valid gap", { wordId: id });
        return prev;
      }
      const before = ordered[index];
      const after = ordered[index + 1];
      const gap = after.start - before.end;
      const available = gap - INSERT_PADDING * 2;
      if (available <= MIN_WORD_DURATION) {
        const message = "Not enough space to insert a word in this gap.";
        setWordError(message);
        flagRowError(before.id, message);
        appendLog("warn", "Insert blocked due to insufficient gap", { before: before.id, after: after.id, gap });
        return prev;
      }
      const start = before.end + INSERT_PADDING;
      const end = after.start - INSERT_PADDING;
      const newId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const newWord = { id: newId, text: "[new word]", start, end };
      const nextWords = [...ordered.slice(0, index + 1), newWord, ...ordered.slice(index + 1)];
      appendLog("info", "Inserted placeholder word", { before: before.id, after: after.id, start, end });
      return nextWords;
    });
  };

  const handleDeleteWord = (id) => {
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    updateWordsSafely((prev) => prev.filter((word) => word.id !== id));
    appendLog("info", "Deleted word", { wordId: id });
  };

  const applyWordChanges = async () => {
    if (!outputId) {
      setError("Generate a video before editing.");
      return;
    }
    if (editedWords.length === 0) {
      const message = "At least one word is required to render.";
      setWordError(message);
      appendLog("warn", "Update blocked: no words present");
      return;
    }
    const validation = validateWordSequence(editedWords);
    if (!validation.valid) {
      setWordError(validation.message);
      if (validation.errorWordId) {
        flagRowError(validation.errorWordId, validation.message);
      }
      appendLog("warn", "Update blocked: validation failed", {
        message: validation.message,
        wordId: validation.errorWordId,
      });
      return;
    }
    if (hasAdjustments(validation.adjustments)) {
      appendLog("warn", "Submitting with auto-resolved overlaps", { adjustments: validation.adjustments });
    }
    appendLog("info", "Submitting edited words", { count: validation.ordered.length, endpoint: "/api/update" });
    setLoading(true);
    setAppState(APP_STATES.rendering);
    try {
      const response = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          output_id: outputId,
          updated_words: validation.ordered,
          font_family: fontSettings.family,
          font_size: fontSettings.size,
          font_color: fontSettings.color,
          font_weight: fontSettings.weight,
          font_custom_path: fontSettings.path,
          video_trim_start: videoTrim.start,
          video_trim_end: videoTrim.end,
        }),
      });
      if (!response.ok) {
        const message = await parseApiError(response);
        appendLog("error", "Word update rejected", { message });
        throw new Error(message);
      }
      const payload = await response.json();
      setResult(payload);
      setWordError("");
      setRowErrors({});
      setStatus("Updated video + lyrics.");
      appendLog("success", "Lyric edits applied", { outputId: payload?.output_id, words: editedWords.length });
      setAppState(APP_STATES.ready);
    } catch (err) {
      const friendlyMessage = (err?.message || "").includes("Output not found")
        ? "We can’t find this render on the server. Please generate a new video before editing."
        : err?.message || "Update failed";
      appendLog("error", "Lyric update failed", { message: friendlyMessage });
      setError(friendlyMessage);
      setWordError(friendlyMessage);
      setAppState(APP_STATES.ready);
    } finally {
      setLoading(false);
    }
  };

  const openTrimModal = () => {
    if (file) {
      setTrimModalOpen(true);
      setAppState(APP_STATES.trimming);
    }
  };

  const applyTrimSelection = () => {
    setTrimSelection({ start: modalRange.start, end: modalRange.end, active: true });
    setTrimModalOpen(false);
    setAppState(APP_STATES.fontConfig);
  };

  const handleCloseTrimModal = () => {
    setTrimModalOpen(false);
    if (hasResult) {
      setAppState(APP_STATES.ready);
      return;
    }
    setAppState(trimSelection.active ? APP_STATES.fontConfig : APP_STATES.uploaded);
  };

  const renderSteps = useMemo(() => {
    const stepsToShow = 5;
    const halfWindow = Math.floor(stepsToShow / 2);
    const total = RENDER_MESSAGES.length;
    const entries = [];

    for (let offset = -halfWindow; offset <= halfWindow; offset += 1) {
      const idx = (renderMessageIndex + offset + total) % total;
      const status = offset < 0 ? "done" : offset === 0 ? "active" : "upcoming";
      entries.push({
        id: `${idx}-${offset}`,
        message: RENDER_MESSAGES[idx],
        status,
      });
    }
    return entries;
  }, [renderMessageIndex]);

  return (
    <main className="app-shell">
      <header className="hero hero-minimal">
        <div className="logo-pill logo-main">Vibr</div>
        <p className="hero-subhead">Word-by-word lyric workspace.</p>
      </header>

      <section className="upload-section single">
        <div className="page-card upload-card">
          <div className="section-heading minimal">
            <h2>Upload</h2>
            <p>Drop audio and trim between 3 seconds and 3 minutes.</p>
          </div>
          <UploadPane
            file={file}
            onFileChange={handleFileChange}
            status={status}
            error={error}
            onOpenTrimmer={openTrimModal}
            trimSelection={trimSelection}
          />
        </div>
      </section>

      {(showPreview || showLyrics) && (
        <section className="workspace-grid">
          <div className="page-card focus-card workspace-panel video-panel">
            <div className="section-heading minimal">
              <h3>Video preview</h3>
              <p>Play the render and watch the word highlights follow along.</p>
            </div>
            {showPreview ? (
              <VideoPreview
                videoUrl={result?.video_url ?? ""}
                videoRef={videoRef}
                videoTrim={videoTrim}
                videoDuration={videoDuration}
              />
            ) : (
              <EmptyState title="No renders yet" body="Upload a clip to unlock the animated preview." />
            )}
          </div>
          <div className="page-card focus-card workspace-panel lyrics-panel-wrapper">
            <div className="section-heading minimal">
              <h3>Word timestamps</h3>
              <p>Edit start/end times, click to seek, and insert new words in the gaps.</p>
            </div>
            {hasResult ? (
              <LyricsPanel
                words={orderedWords}
                visibleChunks={visibleChunks}
                chunkCount={previewChunks.length}
                onWordChange={handleWordTextChange}
                onWordTimeChange={handleWordTimingChange}
                onInsertAfter={handleInsertAfter}
                onDeleteWord={handleDeleteWord}
                activeWordId={activeWordId}
                wordError={wordError}
                rowErrors={rowErrors}
                videoRef={videoRef}
                applyChanges={applyWordChanges}
                loading={loading}
                playbackTime={playbackTime}
              />
            ) : (
              <EmptyState
                title="Lyric grid locked"
                body="Once we process your track you'll be able to edit the synced words right here."
                buttonLabel={file ? "Generate a take" : undefined}
                onAction={file ? handleSubmit : undefined}
              />
            )}
          </div>
        </section>
      )}

      {showTypeface && (
        <section className="page-card full-width style-panel">
          <div className="section-heading minimal">
            <h3>Text & style for render</h3>
            <p>Preview fonts instantly below; changes apply to the next video render.</p>
          </div>
          <FontEditor
            fontSettings={fontSettings}
            fontOptions={fontOptions}
            onUploadFont={handleFontUpload}
            uploading={fontUploading}
            onChange={(partial) => setFontSettings((prev) => ({ ...prev, ...partial }))}
          />
          <p className="helper-text">Font changes won’t affect the on-page overlay—only the rendered video.</p>
          <button className="primary full" type="button" onClick={handleSubmit} disabled={loading || isRendering}>
            {loading && isRendering ? "Rendering your reel..." : "Generate video"}
          </button>
        </section>
      )}
      <TrimModal
        open={trimModalOpen}
        audioUrl={trimPreviewUrl}
        modalRange={modalRange}
        setModalRange={setModalRange}
        applyTrim={applyTrimSelection}
        audioDuration={audioDuration}
        onClose={handleCloseTrimModal}
        waveformPoints={waveformPoints}
        trimLimits={TRIM_LIMITS}
        onDurationDiscovered={(duration) => {
          setAudioDuration(duration);
          if (!modalRange.end) {
            setModalRange({ start: 0, end: Math.min(duration, TRIM_LIMITS.max) });
          }
        }}
      />
      <button
        type="button"
        className={`log-fab ${consoleOpen ? "active" : ""}`}
        onClick={() => setConsoleOpen((prev) => !prev)}
        aria-expanded={consoleOpen}
        aria-label="Toggle activity console"
      >
        <span className="log-fab-icon" aria-hidden="true">⌘</span>
        {clientLogs.length > 0 && <span className="log-fab-count">{Math.min(clientLogs.length, 99)}</span>}
      </button>
      <div className={`client-log-flyout ${consoleOpen ? "open" : ""}`} aria-live="polite">
        <div className="client-log-header">
          <div>
            <h4>Activity & errors</h4>
            <span className="client-log-hint">Newest first. Keeps the last 40 events.</span>
          </div>
          <div className="client-log-actions">
            <button type="button" className="ghost" onClick={() => setClientLogs([])} disabled={!clientLogs.length}>
              Clear
            </button>
            <button type="button" className="ghost" onClick={() => setConsoleOpen(false)}>
              Close
            </button>
          </div>
        </div>
        {clientLogs.length === 0 ? (
          <p className="lyric-tip">Actions, warnings, and API errors will appear here.</p>
        ) : (
          <ul className="client-log-list" aria-live="polite">
            {clientLogs.slice(0, 20).map((entry) => (
              <li key={entry.id} className={`client-log-entry level-${entry.level}`}>
                <div className="client-log-meta">
                  <span className="client-log-level">{entry.level}</span>
                  <span className="client-log-time">{new Date(entry.at).toLocaleTimeString()}</span>
                </div>
                <div className="client-log-message">{entry.message}</div>
                {entry.meta && (
                  <pre className="client-log-meta-block">{JSON.stringify(entry.meta, null, 2)}</pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {isRendering && (
        <div className="rendering-overlay">
          <div className="rendering-card rendering-console">
            <div className="rendering-card-sheen" aria-hidden="true" />
            <div className="rendering-card-backdrop" aria-hidden="true" />
            <div className="rendering-header">
              <div className="rendering-header-meta">
                <span className="rendering-label">VIBR STUDIO</span>
                <div className="rendering-header-bar" aria-hidden="true">
                  <span />
                </div>
              </div>
              <span className="rendering-mini-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
            <div className="rendering-log" aria-live="polite">
              {renderSteps.map((step) => (
                <div key={step.id} className={`rendering-step rendering-${step.status}`}>
                  <span className="rendering-step-icon" aria-hidden="true" />
                  <span className="rendering-step-text">{step.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
