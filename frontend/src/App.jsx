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
  const [statusEvents, setStatusEvents] = useState([]);
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
  const [showAllBars, setShowAllBars] = useState(false);
  const videoRef = useRef(null);
  const uploadRunRef = useRef(0);

  const visibleBars = useMemo(
    () => (showAllBars ? editedBars : editedBars.slice(0, 4)),
    [editedBars, showAllBars],
  );
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
      setShowAllBars(false);
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
    setShowAllBars(false);
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
    setStatusEvents([]);
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
    uploadRunRef.current += 1;
    const runId = uploadRunRef.current;
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
    setStatus("");
    setError("");
    setStatusEvents([]);
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Upload failed");
      }
      if (!response.body) {
        const payload = await response.json();
        if (runId === uploadRunRef.current) {
          setResult(payload);
          setStatus("Lyric video ready!");
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      const upsertStatusEvent = (incoming) => {
        if (runId !== uploadRunRef.current) return;
        const stage = incoming.stage || incoming.label || incoming.message || `stage-${Date.now()}`;
        setStatusEvents((prev) => {
          const entry = {
            stage,
            label: incoming.label || incoming.message || stage,
            detail: incoming.detail,
            state: incoming.state || "complete",
            timestamp: incoming.timestamp || new Date().toISOString(),
          };
          const existingIndex = prev.findIndex((evt) => evt.stage === stage);
          if (existingIndex >= 0) {
            const next = [...prev];
            next[existingIndex] = { ...next[existingIndex], ...entry };
            return next;
          }
          return [...prev, entry];
        });
      };

      const processLine = (line) => {
        if (!line) return;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          log("stream parse error", err, line);
          return;
        }
        if (runId !== uploadRunRef.current) {
          finished = true;
          return;
        }
        if (parsed.type === "status") {
          upsertStatusEvent(parsed);
        } else if (parsed.type === "result") {
          if (runId === uploadRunRef.current) {
            setResult(parsed.payload);
            setStatus("Lyric video ready!");
          }
          finished = true;
        } else if (parsed.type === "error") {
          if (runId === uploadRunRef.current) {
            throw new Error(parsed.message || "Processing failed");
          }
          finished = true;
        }
      };

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          processLine(line);
          if (finished) {
            break;
          }
          newlineIndex = buffer.indexOf("\n");
        }
        if (finished) {
          break;
        }
      }
      if (buffer.trim() && !finished) {
        processLine(buffer.trim());
      }
      if (!finished) {
        throw new Error("Processing finished without a result.");
      }
    } catch (err) {
      log("upload error", err);
      if (runId === uploadRunRef.current) {
        setError(err.message);
        setStatus("");
      }
    } finally {
      if (runId === uploadRunRef.current) {
        setLoading(false);
      }
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
      <header className="hero hero-page">
        <div className="hero-content">
          <div className="logo-pill">Vibr</div>
          <p className="eyebrow">Word-by-word lyric machine</p>
          <h1>
            TikTok-ready reels
            <span>with five-word flashes</span>
          </h1>
          <p>
            Drop your song and we instantly transcribe, timestamp, and pace the captions so only five words hit the screen at once. It feels like the Kashie edits the feed loves—vertical, loud, and surgically synced.
          </p>
          <ul className="hero-highlights">
            <li>Auto word-level timing</li>
            <li>5-word lyric bursts</li>
            <li>Kashie-style editor grid</li>
            <li>9:16 neon overlays</li>
          </ul>
        </div>
        <div className="hero-visual">
          <div className="tiktok-pill">Optimized for TikTok</div>
          <div className="lyric-preview-mock">
            <span>was born</span>
            <span>Had to get</span>
            <span>a new fit, I'm</span>
            <span>wearing</span>
          </div>
          <p className="preview-caption">Word phases pulse in sync with the beat.</p>
        </div>
      </header>

      <section className="upload-section">
        <div className="page-card upload-card">
          <div className="section-heading">
            <h2>Drop a song in</h2>
            <p>Upload MP3, WAV, or M4A. The trim modal pops instantly so you can carve out the exact verse.</p>
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
            statusEvents={statusEvents}
          />
        </div>
        <div className="page-card upload-side">
          <h3>What you get</h3>
          <ul className="marketing-list">
            <li>Transcription + timestamps for every word.</li>
            <li>Auto enforcement of the five-word rule so lines stay punchy.</li>
            <li>Smart trim: minimum 3s, maximum 3m clips so renders fit TikTok.</li>
            <li>Vibr-branded cover frame ready for posting.</li>
          </ul>
          <p className="marketing-note">We only show the editor once a song is dropped so the page stays focused.</p>
        </div>
      </section>

      {showEditorSurface && (
        <>
          <section className="feature-grid">
            <div className="page-card focus-card">
              <div className="section-heading">
                <h3>Dial in the type</h3>
                <p>Keep the neon Inter look or switch fonts and colors before rendering.</p>
              </div>
              <FontEditor fontSettings={fontSettings} onChange={(partial) => setFontSettings((prev) => ({ ...prev, ...partial }))} />
              <p className="helper-text">These settings apply to your next render or lyric update.</p>
            </div>
            <div className="page-card focus-card">
              <div className="section-heading">
                <h3>Preview the cut</h3>
                <p>9:16 playback keeps you honest before exporting.</p>
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
              <div className="section-heading">
                <h3>Kashie-style lyric control</h3>
                <p>The grid shows four bars at a time so you never see more than five words in a burst.</p>
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
                  showAllBars={showAllBars}
                  onToggleAll={() => setShowAllBars((prev) => !prev)}
                  totalBars={editedBars.length}
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
