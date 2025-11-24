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
const MIN_WORD_DURATION = 0.05;
const INSERT_PADDING = 0.02;
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
  let prevEnd = 0;
  for (let idx = 0; idx < ordered.length; idx += 1) {
    const word = ordered[idx];
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) {
      return { valid: false, message: "Start and end times must be numbers." };
    }
    if (word.start < 0) {
      return { valid: false, message: "Word timings cannot be negative." };
    }
    if (word.end - word.start < MIN_WORD_DURATION) {
      return { valid: false, message: "Each word needs at least 50ms of duration." };
    }
    if (idx > 0 && word.start < prevEnd) {
      return { valid: false, message: "Words must be ordered without overlap." };
    }
    prevEnd = Math.max(prevEnd, word.end);
  }
  return { valid: true, ordered };
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
  });
  const [overlaySettings, setOverlaySettings] = useState({
    weight: 600,
    animation: "fade",
  });
  const [editedWords, setEditedWords] = useState([]);
  const [outputId, setOutputId] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTrim, setVideoTrim] = useState({ start: 0, end: 0 });
  const [appState, setAppState] = useState(APP_STATES.idle);
  const [renderMessageIndex, setRenderMessageIndex] = useState(0);
  const [wordError, setWordError] = useState("");
  const [activeWordId, setActiveWordId] = useState("");
  const renderDurationRef = useRef([]);
  const renderTimerRef = useRef(null);
  const videoRef = useRef(null);

  const orderedWords = useMemo(() => sortWordsByTime(editedWords), [editedWords]);
  const previewChunks = useMemo(() => chunkWords(orderedWords), [orderedWords]);
  const visibleChunks = useMemo(() => previewChunks.slice(0, 6), [previewChunks]);
  const overlayStyleVars = useMemo(
    () => ({
      "--overlay-font-family": fontSettings.family,
      "--overlay-font-size": `${fontSettings.size}px`,
      "--overlay-font-color": fontSettings.color,
      "--overlay-font-weight": overlaySettings.weight,
      "--overlay-animation": overlaySettings.animation,
    }),
    [fontSettings, overlaySettings]
  );
  const hasResult = Boolean(result);
  const isRendering = appState === APP_STATES.rendering;
  const isReady = appState === APP_STATES.ready;
  const showTypeface = appState === APP_STATES.fontConfig || isReady || isRendering;
  const showPreview = isReady;
  const showLyrics = isReady;

  useEffect(() => {
    if (!result) {
      setEditedWords([]);
      setOutputId("");
      setVideoDuration(0);
      setVideoTrim({ start: 0, end: 0 });
      setWordError("");
      setActiveWordId("");
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
    setFontSettings({
      size: result.metadata?.font?.size ?? 70,
      family: result.metadata?.font?.family ?? "Inter",
      color: result.metadata?.font?.color ?? "#ffffff",
    });
    setAppState(APP_STATES.ready);
  }, [result]);

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
    const node = videoRef.current;
    if (!node) {
      setActiveWordId("");
      return undefined;
    }
    const handleTimeUpdate = () => {
      const currentTime = node.currentTime ?? 0;
      const active = orderedWords.find((word) => currentTime >= word.start && currentTime < word.end);
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
      setWaveformPoints([]);
      setAudioDuration(0);
      setModalRange({ start: 0, end: 0 });
    }
  }, []);

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
    if (trimSelection.active) {
      formData.append("trim_start", trimSelection.start.toString());
      formData.append("trim_end", trimSelection.end.toString());
    }
    log("uploading file", file.name);
    setLoading(true);
    setAppState(APP_STATES.rendering);
    setStatus("Uploading audio...");
    setError("");
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      const payload = await response.json();
      setResult(payload);
      setStatus("Lyric video ready!");
      setAppState(APP_STATES.ready);
    } catch (err) {
      log("upload error", err);
      setError(err.message);
      setStatus("");
      setAppState(APP_STATES.fontConfig);
    } finally {
      setLoading(false);
    }
  };
  const updateWordsSafely = useCallback(
    (updater) => {
      setEditedWords((prev) => {
        const next = updater(prev);
        const validation = validateWordSequence(next);
        if (!validation.valid) {
          setWordError(validation.message);
          return prev;
        }
        setWordError("");
        return validation.ordered;
      });
    },
    [setEditedWords, setWordError]
  );

  const handleWordTextChange = (id, text) => {
    updateWordsSafely((prev) => prev.map((word) => (word.id === id ? { ...word, text } : word)));
  };

  const handleWordTimingChange = (id, key, rawValue) => {
    const numeric = Number.parseFloat(rawValue);
    if (!Number.isFinite(numeric)) {
      setWordError("Enter a numeric timestamp in seconds.");
      return;
    }
    updateWordsSafely((prev) => prev.map((word) => (word.id === id ? { ...word, [key]: numeric } : word)));
  };

  const handleInsertAfter = (id) => {
    updateWordsSafely((prev) => {
      const ordered = sortWordsByTime(prev);
      const index = ordered.findIndex((word) => word.id === id);
      if (index === -1 || index === ordered.length - 1) {
        setWordError("Select a gap between two words to insert a new one.");
        return prev;
      }
      const before = ordered[index];
      const after = ordered[index + 1];
      const gap = after.start - before.end;
      const available = gap - INSERT_PADDING * 2;
      if (available <= MIN_WORD_DURATION) {
        setWordError("Not enough space to insert a word in this gap.");
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
      return nextWords;
    });
  };

  const applyWordChanges = async () => {
    if (!outputId) {
      setError("Generate a video before editing.");
      return;
    }
    const validation = validateWordSequence(editedWords);
    if (!validation.valid) {
      setWordError(validation.message);
      return;
    }
    setLoading(true);
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
          video_trim_start: videoTrim.start,
          video_trim_end: videoTrim.end,
        }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        const message = detail?.detail || "Update failed";
        throw new Error(message);
      }
      const payload = await response.json();
      setResult(payload);
      setWordError("");
      setStatus("Updated video + lyrics.");
    } catch (err) {
      log("update error", err);
      setError(err.message);
      setWordError(err.message);
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
          <div className="page-card focus-card workspace-panel">
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
                activeWordId={activeWordId}
                wordError={wordError}
                overlayStyle={overlayStyleVars}
                videoRef={videoRef}
                applyChanges={applyWordChanges}
                loading={loading}
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
            <h3>Text, style & animation</h3>
            <p>Fine-tune the overlay. Changes preview instantly; apply to re-render.</p>
          </div>
          <div className="style-grid">
            <FontEditor
              fontSettings={fontSettings}
              onChange={(partial) => setFontSettings((prev) => ({ ...prev, ...partial }))}
            />
            <div className="style-stack">
              <label className="font-control">
                <span>Font weight</span>
                <select
                  value={overlaySettings.weight}
                  onChange={(event) => setOverlaySettings((prev) => ({ ...prev, weight: Number(event.target.value) }))}
                >
                  {[400, 500, 600, 700, 800].map((weight) => (
                    <option key={weight} value={weight}>
                      {weight}
                    </option>
                  ))}
                </select>
              </label>
              <label className="font-control">
                <span>Word animation</span>
                <select
                  value={overlaySettings.animation}
                  onChange={(event) => setOverlaySettings((prev) => ({ ...prev, animation: event.target.value }))}
                >
                  <option value="fade">Fade up</option>
                  <option value="slide">Slide in</option>
                  <option value="pop">Pop</option>
                </select>
              </label>
            </div>
          </div>
          <p className="helper-text">Applies to the next render.</p>
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
