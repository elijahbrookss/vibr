import { useEffect, useRef, useState } from "react";
import WaveformBackdrop from "./WaveformBackdrop";
import { formatTimestamp } from "../utils/time";

const DEFAULT_LIMITS = { min: 3, max: 180 };

function TrimModal({
  open,
  onClose,
  audioUrl,
  modalRange,
  setModalRange,
  applyTrim,
  audioDuration,
  waveformPoints,
  onDurationDiscovered,
  trimLimits = DEFAULT_LIMITS,
}) {
  if (!open) return null;
  const trackRef = useRef(null);
  const audioRef = useRef(null);
  const previewRangeRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [discoveredDuration, setDiscoveredDuration] = useState(audioDuration);
  const minSelection = Math.max(0, trimLimits?.min ?? DEFAULT_LIMITS.min);
  const maxSelection = Math.max(minSelection, trimLimits?.max ?? DEFAULT_LIMITS.max);
  const sliderMax = Math.max(audioDuration || 0, modalRange.end || 0.01, 0.01);
  const startValue = modalRange.start ?? 0;
  const endValue = modalRange.end ?? sliderMax;
  const startPercent = (startValue / sliderMax) * 100;
  const endPercent = (endValue / sliderMax) * 100;

  const adjustStart = (value, options = {}) => {
    let nextStart = startValue;
    let nextEnd = endValue;
    setModalRange((prev) => {
      const currentEnd = prev.end ?? sliderMax;
      const minAllowed = Math.max(0, currentEnd - maxSelection);
      const maxAllowed = Math.max(0, currentEnd - minSelection);
      const bounded = Math.min(Math.max(value, minAllowed), Math.max(minAllowed, maxAllowed));
      nextStart = Number(bounded.toFixed(2));
      nextEnd = currentEnd;
      return { ...prev, start: nextStart };
    });
    if (options.preview) {
      startPreview({ start: nextStart, end: nextEnd });
    }
  };

  const adjustEnd = (value, options = {}) => {
    let nextStart = startValue;
    let nextEnd = endValue;
    setModalRange((prev) => {
      const currentStart = prev.start ?? 0;
      const minAllowed = currentStart + minSelection;
      const maxAllowed = Math.min(sliderMax, currentStart + maxSelection);
      const bounded = Math.max(Math.min(value, maxAllowed), Math.min(minAllowed, maxAllowed));
      nextStart = currentStart;
      nextEnd = Number(bounded.toFixed(2));
      return { ...prev, end: nextEnd };
    });
    if (options.preview) {
      startPreview({ start: nextStart, end: nextEnd });
    }
  };

  const selectionStartRatio = startValue / sliderMax;
  const selectionEndRatio = endValue / sliderMax;
  const selectionDuration = Math.max(0, endValue - startValue);
  const durationLabel = formatTimestamp(selectionDuration);
  const validationMessage =
    selectionDuration < minSelection
      ? `Need at least ${formatTimestamp(minSelection)} selected.`
      : selectionDuration > maxSelection
      ? `Max selection is ${formatTimestamp(maxSelection)}.`
      : "";
  const isApplyDisabled = Boolean(validationMessage);

  const positionToValue = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return ratio * sliderMax;
  };

  const beginHandleDrag = (handle) => (event) => {
    event.preventDefault();
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    target.setPointerCapture?.(pointerId);
    const move = (clientX) => {
      const value = positionToValue(clientX);
      if (handle === "start") {
        adjustStart(value, { preview: true });
      } else {
        adjustEnd(value, { preview: true });
      }
    };
    move(event.clientX);
    const onMove = (moveEvent) => move(moveEvent.clientX);
    const onUp = () => {
      target.releasePointerCapture?.(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      endPreview();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startPreview = ({ start, end }) => {
    const audio = audioRef.current;
    if (!audio) return;
    const duration = discoveredDuration || audio.duration || sliderMax;
    if (!Number.isFinite(duration)) return;
    const safeStart = Math.min(Math.max(start ?? 0, 0), duration);
    const safeEnd = Math.max(Math.min(end ?? duration, duration), safeStart + 0.01);
    previewRangeRef.current = { start: safeStart, end: safeEnd };
    const shouldSeek =
      Math.abs(audio.currentTime - safeStart) > 0.05 || audio.currentTime < safeStart || audio.currentTime > safeEnd;
    if (shouldSeek) {
      audio.currentTime = safeStart;
    }
    if (audio.paused) {
      audio.play();
      setIsPlaying(true);
    }
  };

  const endPreview = () => {
    const audio = audioRef.current;
    previewRangeRef.current = null;
    if (audio) {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!Number.isFinite(audio.duration)) {
      audio.load();
    }
    const selection = { start: startValue, end: endValue };
    previewRangeRef.current = selection;
    if (audio.paused) {
      const shouldSeek = audio.currentTime < selection.start || audio.currentTime > selection.end - 0.05;
      if (shouldSeek) {
        audio.currentTime = selection.start;
      }
      audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      const duration = discoveredDuration || audio.duration || sliderMax;
      const preview = previewRangeRef.current;
      if (preview && audio.currentTime >= preview.end - 0.01) {
        audio.pause();
        setIsPlaying(false);
      }
      if (Number.isFinite(duration) && audio.currentTime > duration) {
        audio.pause();
        setIsPlaying(false);
      }
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, [discoveredDuration, sliderMax]);

  const progressPercent = (() => {
    const duration = discoveredDuration || sliderMax;
    if (!duration) return 0;
    return Math.min(100, (currentTime / duration) * 100);
  })();

  return (
    <div className="trim-modal-backdrop">
      <div className="trim-modal">
        <header>
          <h3>Trim audio (optional)</h3>
          <p>Drag handles to isolate the verse you need. We keep the bars in sync with the trim.</p>
        </header>
        <div className="trim-player">
          <button className="player-button" type="button" onClick={togglePlayback} aria-label={isPlaying ? "Pause" : "Play"}>
            <span className={`player-icon ${isPlaying ? "pause" : "play"}`} aria-hidden="true" />
          </button>
          <div className="player-progress">
            <div className="player-progress-bar">
              <div className="player-progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="player-times">
              <span>{formatTimestamp(currentTime)}</span>
              <span>{formatTimestamp(discoveredDuration || sliderMax)}</span>
            </div>
          </div>
        </div>
        <audio
          ref={audioRef}
          src={audioUrl}
          className="trim-audio"
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration;
            if (Number.isFinite(duration)) {
              setDiscoveredDuration(duration);
              if (!audioDuration) {
                onDurationDiscovered?.(duration);
              }
            }
          }}
        />
        <div className="trim-track live" ref={trackRef}>
          <WaveformBackdrop points={waveformPoints} selectionStart={selectionStartRatio} selectionEnd={selectionEndRatio} />
          <div
            className="trim-highlight"
            style={{
              left: `${startPercent}%`,
              width: `${endPercent - startPercent}%`,
            }}
          />
          <div className="trim-handle start" style={{ left: `${startPercent}%` }} onPointerDown={beginHandleDrag("start")}>
            <span>{formatTimestamp(modalRange.start)}</span>
          </div>
          <div className="trim-handle end" style={{ left: `${endPercent}%` }} onPointerDown={beginHandleDrag("end")}>
            <span>{formatTimestamp(modalRange.end)}</span>
          </div>
          <input
            type="range"
            className="range-input start"
            min="0"
            max={sliderMax}
            step="0.01"
            value={modalRange.start}
            aria-label="Trim start"
            onChange={(event) => adjustStart(Number(event.target.value))}
          />
          <input
            type="range"
            className="range-input end"
            min="0"
            max={sliderMax}
            step="0.01"
            value={modalRange.end}
            aria-label="Trim end"
            onChange={(event) => adjustEnd(Number(event.target.value))}
          />
        </div>
        <div className="trim-modal-actions">
          <div>
            <p className="trim-duration-text">{durationLabel} selected</p>
            <p className="trim-limits">Min {formatTimestamp(minSelection)} • Max {formatTimestamp(maxSelection)}</p>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setModalRange({ start: 0, end: Math.min(sliderMax, maxSelection) })}
            >
              Use full track
            </button>
          </div>
          <div className="trim-buttons">
            <button className="ghost-button" type="button" onClick={onClose}>
              Close
            </button>
            <button className="primary" type="button" onClick={applyTrim} disabled={isApplyDisabled}>
              Apply trim
            </button>
          </div>
        </div>
        {validationMessage && <p className="trim-validation">{validationMessage}</p>}
      </div>
    </div>
  );
}

export default TrimModal;
