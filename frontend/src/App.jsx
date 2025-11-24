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
  const [editedWords, setEditedWords] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [outputId, setOutputId] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTrim, setVideoTrim] = useState({ start: 0, end: 0 });
  const [appState, setAppState] = useState(APP_STATES.idle);
  const [renderMessageIndex, setRenderMessageIndex] = useState(0);
  const renderDurationRef = useRef([]);
  const renderTimerRef = useRef(null);
  const videoRef = useRef(null);

  const visibleChunks = useMemo(() => chunks.slice(0, 6), [chunks]);
  const hasResult = Boolean(result);
  const isRendering = appState === APP_STATES.rendering;
  const isReady = appState === APP_STATES.ready;
  const showTypeface = appState === APP_STATES.fontConfig || isReady || isRendering;
  const showPreview = isReady;
  const showLyrics = isReady;

  useEffect(() => {
    if (!result) {
      setEditedWords([]);
      setChunks([]);
      setOutputId("");
      setVideoDuration(0);
      setVideoTrim({ start: 0, end: 0 });
      if (!file) {
        setAppState(APP_STATES.idle);
      }
      return;
    }
    const duration = result.metadata?.video_duration ?? 0;
    setEditedWords(result.words ?? []);
    setChunks(result.chunks ?? []);
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

  const handleWordTextChange = (id, text) => {
    setEditedWords((prev) => prev.map((word) => (word.id === id ? { ...word, text } : word)));
  };

  const applyWordChanges = async () => {
    if (!outputId) {
      setError("Generate a video before editing.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          output_id: outputId,
          updated_words: editedWords,
          font_family: fontSettings.family,
          font_size: fontSettings.size,
          font_color: fontSettings.color,
          video_trim_start: videoTrim.start,
          video_trim_end: videoTrim.end,
        }),
      });
      if (!response.ok) throw new Error("Update failed");
      const payload = await response.json();
      setResult(payload);
      setStatus("Updated video + lyrics.");
    } catch (err) {
      log("update error", err);
      setError(err.message);
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

      {showTypeface && (
        <section className="feature-grid minimal-grid">
          <div className="page-card focus-card">
            <div className="section-heading minimal">
              <h3>Typeface</h3>
              <p>Size, family, color.</p>
            </div>
            <FontEditor fontSettings={fontSettings} onChange={(partial) => setFontSettings((prev) => ({ ...prev, ...partial }))} />
            <p className="helper-text">Applies to the next render.</p>
            <button className="primary full" type="button" onClick={handleSubmit} disabled={loading || isRendering}>
              {loading && isRendering ? "Rendering your reel..." : "Generate video"}
            </button>
          </div>
          {showPreview && (
            <div className="page-card focus-card">
              <div className="section-heading minimal">
                <h3>Preview</h3>
                <p>Play the render.</p>
              </div>
              {hasResult ? (
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
          )}
        </section>
      )}

      {showLyrics && (
      <section className="lyrics-stack">
        <div className="page-card full-width">
          <div className="section-heading minimal">
            <h3>Lyrics</h3>
            <p>Word-level edits, chunked into four-word phrases.</p>
          </div>
          {hasResult ? (
            <LyricsPanel
              words={editedWords}
              visibleChunks={visibleChunks}
              chunkCount={chunks.length}
              onWordChange={handleWordTextChange}
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
