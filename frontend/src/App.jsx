import { useState, useEffect, useRef, useMemo } from "react";
import "./App.css";

const log = (...args) => console.debug("[LyricPortal]", ...args);
const fontFamilies = ["Inter", "Roboto", "Montserrat", "Space Grotesk", "Avenir"];

const formatTimestamp = (value) => {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

function UploadPane({ file, loading, onFileChange, onSubmit, status, error }) {
  return (
    <section className="panel upload-pane">
      <h2>Upload audio</h2>
      <p>Drop a clip, trim it, choose a font, and spin out a beat-ready lyric video.</p>
      <label className="file-label">
        <span>{file?.name ?? "Choose MP3 / WAV / M4A"}</span>
        <input type="file" accept="audio/*" onChange={onFileChange} className="screen-reader-only" />
      </label>
      <button className="primary" onClick={onSubmit} disabled={loading}>
        {loading ? "Rendering..." : "Generate lyric video"}
      </button>
      {status && <p className="status success">{status}</p>}
      {error && <p className="status error">{error}</p>}
    </section>
  );
}

function FontEditor({ fontSettings, onChange }) {
  return (
    <div className="font-editor">
      <div className="font-control">
        <label>
          Font family
          <select
            value={fontSettings.family}
            onChange={(event) => onChange({ family: event.target.value })}
          >
            {fontFamilies.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="font-control">
        <label>
          Font size
          <span className="font-value">{fontSettings.size}px</span>
        </label>
        <input
          type="range"
          min="48"
          max="120"
          value={fontSettings.size}
          onChange={(event) => onChange({ size: Number(event.target.value) })}
        />
      </div>
      <div className="font-control color-control">
        <label>Font color</label>
        <input
          type="color"
          value={fontSettings.color}
          onChange={(event) => onChange({ color: event.target.value })}
        />
      </div>
    </div>
  );
}

function LyricsList({
  visibleBars,
  extraCount,
  setEditingIndex,
  editingIndex,
  handleBarTextChange,
  wordPhases,
  videoRef,
  removeBar,
  addBar,
  applyChanges,
  loading,
}) {
  return (
    <section className="panel lyrics-panel">
      <div className="panel-header">
        <div>
          <h3>Rendered lyrics</h3>
          <p className="subtitle">Trimmed delivery — only the freshest four chords.</p>
        </div>
        <button className="ghost-button" onClick={addBar}>
          + Add lyric
        </button>
      </div>
      <ol>
        {visibleBars.length === 0 && <li className="lyric-tip">Nothing here yet.</li>}
        {visibleBars.map((bar, idx) => {
          const wordsSource =
            bar.words && bar.words.length
              ? bar.words
              : (bar.text ?? "")
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((text) => ({ text }));
          const phase = wordPhases[idx] ?? "group";
          const mainWords = wordsSource.slice(0, 5);
          const overflowWord = wordsSource[5];
          const displayWords = phase === "single" && overflowWord ? [overflowWord] : mainWords;
          const isEditing = editingIndex === idx;
          return (
            <li key={`${bar.start}-${idx}`} className="lyric-bar">
              <div className="timestamp-row">
                <button
                  type="button"
                  className="seek"
                  onClick={() => {
                    if (videoRef.current) videoRef.current.currentTime = Math.max(0, bar.start);
                  }}
                >
                  Start {formatTimestamp(bar.start)}
                </button>
                <span className="timestamp">End {formatTimestamp(bar.end)}</span>
              </div>
              <div className={`lyric-edit ${isEditing ? "active" : ""}`}>
                {isEditing ? (
                  <textarea
                    value={bar.text}
                    onChange={(event) => handleBarTextChange(idx, event.target.value)}
                    rows={2}
                    placeholder="Type lyric copy"
                  />
                ) : (
                  <p onDoubleClick={() => setEditingIndex(idx)}>
                    {bar.text || "Double-tap to edit lyric"}
                  </p>
                )}
                <div className="lyric-actions">
                  <button
                    className="ghost-button"
                    onClick={() => setEditingIndex(isEditing ? null : idx)}
                    type="button"
                  >
                    {isEditing ? "Done" : "Edit"}
                  </button>
                  <button className="ghost-button" onClick={() => removeBar(idx)} type="button">
                    Delete
                  </button>
                </div>
              </div>
              <div className="bar-words animated">
                {displayWords.map((word, idy) => (
                  <span
                    key={`${word.text}-${idy}`}
                    className="word-chip"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = Math.max(0, word.start ?? bar.start);
                      }
                    }}
                  >
                    {word.text}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
        {extraCount > 0 && (
          <li className="lyric-note">+{extraCount} additional bars hidden above</li>
        )}
      </ol>
      <div className="update-actions">
        <button className="primary" onClick={applyChanges} disabled={loading}>
          {loading ? "Updating..." : "Update video & lyrics"}
        </button>
        <span className="update-note">Every call rewrites the final render.</span>
      </div>
    </section>
  );
}

function TrimModal({ open, onClose, audioUrl, modalRange, setModalRange, applyTrim, audioDuration }) {
  if (!open) return null;
  const sliderMax = Math.max(audioDuration, 0.01);
  const startPercent = (modalRange.start / sliderMax) * 100;
  const endPercent = (modalRange.end / sliderMax) * 100;
  const adjustStart = (value) =>
    setModalRange((prev) => ({ ...prev, start: Math.min(value, (prev.end ?? sliderMax) - 0.05) }));
  const adjustEnd = (value) =>
    setModalRange((prev) => ({ ...prev, end: Math.max(value, (prev.start ?? 0) + 0.05) }));
  return (
    <div className="trim-modal-backdrop">
      <div className="trim-modal">
        <header>
          <h3>Trim audio (optional)</h3>
          <p>Drag handles to isolate the verse you need.</p>
        </header>
        <audio ref={null} controls src={audioUrl} className="trim-audio" />
        <div className="trim-track">
          <div
            className="trim-highlight"
            style={{
              left: `${startPercent}%`,
              width: `${endPercent - startPercent}%`,
            }}
          />
          <div className="trim-handle start" style={{ left: `${startPercent}%` }} />
          <div className="trim-handle end" style={{ left: `${endPercent}%` }} />
          <input
            type="range"
            className="range-input start"
            min="0"
            max={sliderMax}
            value={modalRange.start}
            onChange={(event) => adjustStart(Number(event.target.value))}
          />
          <input
            type="range"
            className="range-input end"
            min="0"
            max={sliderMax}
            value={modalRange.end}
            onChange={(event) => adjustEnd(Number(event.target.value))}
          />
        </div>
        <div className="trim-modal-actions">
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
          <button className="primary" type="button" onClick={applyTrim}>
            Apply trim
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const trimAudioRef = useRef(null);
  const trackRef = useRef(null);

  const visibleBars = useMemo(() => editedBars.slice(0, 4), [editedBars]);
  const wordPhaseBars = useMemo(() => visibleBars.map((bar, idx) => [idx, bar]), [visibleBars]);

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

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    if (selectedFile) {
      setTrimModalOpen(true);
      setModalRange({ start: 0, end: 0 });
      setTrimSelection({ start: 0, end: 0, active: false });
      setAudioDuration(0);
      if (trimPreviewUrl) URL.revokeObjectURL(trimPreviewUrl);
      setTrimPreviewUrl(URL.createObjectURL(selectedFile));
    } else {
      setTrimModalOpen(false);
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

  return (
    <main className="portal">
      <UploadPane
        file={file}
        loading={loading}
        onFileChange={handleFileChange}
        onSubmit={handleSubmit}
        status={status}
        error={error}
      />
      <FontEditor fontSettings={fontSettings} onChange={(partial) => setFontSettings((prev) => ({ ...prev, ...partial }))} />
      <div className="content-grid">
        <div className="preview-card">
          <div className="video-wrapper">
            <video ref={videoRef} controls src={result?.video_url ?? ""} className="preview-video" />
          </div>
          {result?.metadata && (
            <div className="trim-panel">
              <strong>Final trim</strong>
              <div className="trim-track">
                <div
                  className="trim-highlight"
                  style={{
                    left: `${(videoTrim.start / Math.max(videoDuration, 1)) * 100}%`,
                    width: `${Math.max(((videoTrim.end - videoTrim.start) / Math.max(videoDuration, 1)) * 100, 0)}%`,
                  }}
                />
              </div>
              <div className="trim-labels">
                <span>{formatTimestamp(videoTrim.start)}</span>
                <span>{formatTimestamp(videoTrim.end)}</span>
              </div>
            </div>
          )}
        </div>
        <LyricsList
          visibleBars={visibleBars}
          editedBars={editedBars}
          editingIndex={editingIndex}
          setEditingIndex={setEditingIndex}
          handleBarTextChange={handleBarTextChange}
          wordPhases={wordPhases}
          videoRef={videoRef}
          removeBar={removeBar}
          addBar={addBar}
          applyChanges={applyBarChanges}
          extraCount={Math.max(0, editedBars.length - visibleBars.length)}
          loading={loading}
        />
      </div>
      <TrimModal
        open={trimModalOpen}
        audioUrl={trimPreviewUrl}
        modalRange={modalRange}
        applyTrim={() => {
          setTrimSelection({ start: modalRange.start, end: modalRange.end, active: true });
          setTrimModalOpen(false);
        }}
        setModalRange={setModalRange}
        audioDuration={audioDuration}
        onClose={() => {
          setTrimModalOpen(false);
          if (trimPreviewUrl) {
            URL.revokeObjectURL(trimPreviewUrl);
            setTrimPreviewUrl("");
          }
        }}
      />
    </main>
  );
}

export default App;
