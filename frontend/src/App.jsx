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
  const [editedBars, setEditedBars] = useState([]);
  const [wordPhases, setWordPhases] = useState({});
  const [editingIndex, setEditingIndex] = useState(null);
  const [outputId, setOutputId] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTrim, setVideoTrim] = useState({ start: 0, end: 0 });
  const videoRef = useRef(null);

  const visibleBars = useMemo(() => editedBars.slice(0, 4), [editedBars]);
  const wordPhaseBars = useMemo(() => visibleBars.map((bar, idx) => [idx, bar]), [visibleBars]);
  const hasResult = Boolean(result);
  const showEditorSurface = Boolean(file || hasResult);

  useEffect(() => {
    if (!result) {
      setEditedBars([]);
      setWordPhases({});
      setOutputId("");
      setVideoDuration(0);
      setVideoTrim({ start: 0, end: 0 });
      return;
    }
    const duration = result.metadata?.video_duration ?? 0;
    setEditedBars(result.bars ?? []);
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
    setWordPhases({});
  }, [result]);

  useEffect(() => {
    return () => {
      if (trimPreviewUrl) URL.revokeObjectURL(trimPreviewUrl);
    };
  }, [trimPreviewUrl]);

  useEffect(() => {
    const timers = {};
    const phases = {};
    wordPhaseBars.forEach(([idx, bar]) => {
      const count = bar.words?.length ?? 0;
      phases[idx] = count <= 5 ? "group" : "group";
      if (count > 5) {
        timers[idx] = setTimeout(() => {
          setWordPhases((prev) => ({ ...prev, [idx]: "single" }));
        }, 1000);
      }
    });
    setWordPhases((prev) => ({ ...prev, ...phases }));
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, [wordPhaseBars]);

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
    setStatus("");
    setError("");
    if (trimPreviewUrl) {
      URL.revokeObjectURL(trimPreviewUrl);
      setTrimPreviewUrl("");
    }
    if (selectedFile) {
      const nextUrl = URL.createObjectURL(selectedFile);
      setTrimPreviewUrl(nextUrl);
      setTrimModalOpen(true);
      processAudioForTrim(selectedFile);
    } else {
      setTrimModalOpen(false);
      setWaveformPoints([]);
      setTrimSelection({ start: 0, end: 0, active: false });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
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
    } catch (err) {
      log("upload error", err);
      setError(err.message);
      setStatus("");
    } finally {
      setLoading(false);
    }
  };

  const handleBarTextChange = (idx, text) => {
    setEditedBars((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], text };
      return next;
    });
  };

  const addBar = () => {
    setEditedBars((prev) => [
      ...prev,
      {
        text: "",
        start: prev.length ? Math.max(...prev.map((bar) => bar.end)) + 0.1 : 0,
        end: (prev.length ? Math.max(...prev.map((bar) => bar.end)) + 0.5 : 1) || 1,
        words: [],
      },
    ]);
    setEditingIndex(editedBars.length);
  };

  const removeBar = (idx) => {
    log("removing bar", idx);
    setEditedBars((prev) => prev.filter((_, index) => index !== idx));
    if (editingIndex === idx) setEditingIndex(null);
  };

  const applyBarChanges = async () => {
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
          updated_bars: editedBars,
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
    if (file) setTrimModalOpen(true);
  };

  const applyTrimSelection = () => {
    setTrimSelection({ start: modalRange.start, end: modalRange.end, active: true });
    setTrimModalOpen(false);
  };

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
            loading={loading}
            onFileChange={handleFileChange}
            onSubmit={handleSubmit}
            status={status}
            error={error}
            onOpenTrimmer={openTrimModal}
            trimSelection={trimSelection}
          />
        </div>
      </section>

      {showEditorSurface && (
        <>
          <section className="feature-grid minimal-grid">
            <div className="page-card focus-card">
              <div className="section-heading minimal">
                <h3>Typeface</h3>
                <p>Size, family, color.</p>
              </div>
              <FontEditor fontSettings={fontSettings} onChange={(partial) => setFontSettings((prev) => ({ ...prev, ...partial }))} />
              <p className="helper-text">Applies to the next render.</p>
            </div>
            <div className="page-card focus-card">
              <div className="section-heading minimal">
                <h3>Preview</h3>
                <p>Play the render.</p>
              </div>
              {hasResult ? (
                <VideoPreview videoUrl={result?.video_url ?? ""} videoRef={videoRef} videoTrim={videoTrim} videoDuration={videoDuration} />
              ) : (
                <EmptyState title="No renders yet" body="Upload a clip to unlock the animated preview." />
              )}
            </div>
          </section>

          <section className="lyrics-stack">
            <div className="page-card full-width">
              <div className="section-heading minimal">
                <h3>Lyrics</h3>
                <p>Five words max per line.</p>
              </div>
              {hasResult ? (
                <LyricsPanel
                  visibleBars={visibleBars}
                  extraCount={Math.max(0, editedBars.length - visibleBars.length)}
                  setEditingIndex={setEditingIndex}
                  editingIndex={editingIndex}
                  handleBarTextChange={handleBarTextChange}
                  wordPhases={wordPhases}
                  videoRef={videoRef}
                  removeBar={removeBar}
                  addBar={addBar}
                  applyChanges={applyBarChanges}
                  loading={loading}
                />
              ) : (
                <EmptyState
                  title="Lyric grid locked"
                  body="Once we process your track you'll be able to edit the synced bars right here."
                  buttonLabel={file ? "Generate a take" : undefined}
                  onAction={file ? handleSubmit : undefined}
                />
              )}
            </div>
          </section>
        </>
      )}
      <TrimModal
        open={trimModalOpen}
        audioUrl={trimPreviewUrl}
        modalRange={modalRange}
        setModalRange={setModalRange}
        applyTrim={applyTrimSelection}
        audioDuration={audioDuration}
        onClose={() => setTrimModalOpen(false)}
        waveformPoints={waveformPoints}
        trimLimits={TRIM_LIMITS}
        onDurationDiscovered={(duration) => {
          setAudioDuration(duration);
          if (!modalRange.end) {
            setModalRange({ start: 0, end: Math.min(duration, TRIM_LIMITS.max) });
          }
        }}
      />
    </main>
  );
}

export default App;
