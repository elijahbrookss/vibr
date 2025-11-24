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
  const wasPlayingOnDragRef = useRef(false);
  const latestRangeRef = useRef(modalRange);
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
      startPreview({ start: nextStart, end: nextEnd, source: "start" });
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
      startPreview({ start: nextStart, end: nextEnd, source: "end" });
    }
  };

  useEffect(() => {
    latestRangeRef.current = {
      start: modalRange.start ?? 0,
      end: modalRange.end ?? sliderMax,
    };
  }, [modalRange, sliderMax]);

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
    wasPlayingOnDragRef.current = !audioRef.current?.paused;
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
      endPreview(handle);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startPreview = ({ start, end, source }) => {
    const audio = audioRef.current;
    if (!audio) return;
    const duration = discoveredDuration || audio.duration || sliderMax;
    if (!Number.isFinite(duration)) return;
    const safeStart = Math.min(Math.max(start ?? 0, 0), duration);
    const safeEnd = Math.max(Math.min(end ?? duration, duration), safeStart + 0.01);
    const scrubTarget = source === "end" ? safeEnd : safeStart;
    previewRangeRef.current = { start: safeStart, end: safeEnd };
    const shouldSeek = Math.abs(audio.currentTime - scrubTarget) > 0.01;
    if (shouldSeek || audio.currentTime < safeStart || audio.currentTime > safeEnd) {
      audio.currentTime = scrubTarget;
    }
    if (audio.paused) {
      audio.play();
      setIsPlaying(true);
    }
  };

  const endPreview = (handle) => {
    const audio = audioRef.current;
    const { start: latestStart = 0, end: latestEnd = sliderMax } = latestRangeRef.current || {};
    const shouldContinue = wasPlayingOnDragRef.current && audio && !audio.paused;
    if (handle === "start" && audio) {
      const snapStart = Math.max(0, latestStart);
      audio.currentTime = snapStart;
      setCurrentTime(snapStart);
    }
    if (shouldContinue) {
      previewRangeRef.current = { start: latestStart, end: latestEnd };
      wasPlayingOnDragRef.current = false;
      return;
    }
    previewRangeRef.current = null;
    wasPlayingOnDragRef.current = false;
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
      const shouldSeek =
        Math.abs(audio.currentTime - selection.start) > 0.01 || audio.currentTime < selection.start || audio.currentTime > selection.end;
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
      if (preview) {
        const { start, end } = preview;
        if (audio.currentTime >= end - 0.01) {
          audio.currentTime = start;
        }
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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying) return;
    const nextRange = { start: startValue, end: endValue };
    previewRangeRef.current = nextRange;
    if (audio.currentTime < nextRange.start || audio.currentTime > nextRange.end) {
      audio.currentTime = nextRange.start;
    }
  }, [endValue, isPlaying, startValue]);

  const progressPercent = (() => {
    if (selectionDuration <= 0) return 0;
    const relative = Math.max(0, currentTime - startValue);
    return Math.min(100, (relative / selectionDuration) * 100);
  })();

  const displayedCurrent = selectionDuration > 0 ? Math.min(Math.max(0, currentTime - startValue), selectionDuration) : currentTime;
  const displayedTotal = selectionDuration > 0 ? selectionDuration : discoveredDuration || sliderMax;

  return (
    <div className="trim-modal-backdrop">
      <div className="trim-modal">
        <header>
          <h3>Trim audio (optional)</h3>
          <p>Trim the audio to the section you want.</p>
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
              <span>{formatTimestamp(displayedCurrent)}</span>
              <span>{formatTimestamp(displayedTotal)}</span>
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
              className="ghost-button use-full-track"
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
