import { useRef } from "react";
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
  const minSelection = Math.max(0, trimLimits?.min ?? DEFAULT_LIMITS.min);
  const maxSelection = Math.max(minSelection, trimLimits?.max ?? DEFAULT_LIMITS.max);
  const sliderMax = Math.max(audioDuration || 0, modalRange.end || 0.01, 0.01);
  const startValue = modalRange.start ?? 0;
  const endValue = modalRange.end ?? sliderMax;
  const startPercent = (startValue / sliderMax) * 100;
  const endPercent = (endValue / sliderMax) * 100;

  const adjustStart = (value) =>
    setModalRange((prev) => {
      const currentEnd = prev.end ?? sliderMax;
      const minAllowed = Math.max(0, currentEnd - maxSelection);
      const maxAllowed = Math.max(0, currentEnd - minSelection);
      const bounded = Math.min(Math.max(value, minAllowed), Math.max(minAllowed, maxAllowed));
      return { ...prev, start: Number(bounded.toFixed(2)) };
    });
  const adjustEnd = (value) =>
    setModalRange((prev) => {
      const currentStart = prev.start ?? 0;
      const minAllowed = currentStart + minSelection;
      const maxAllowed = Math.min(sliderMax, currentStart + maxSelection);
      const bounded = Math.max(Math.min(value, maxAllowed), Math.min(minAllowed, maxAllowed));
      return { ...prev, end: Number(bounded.toFixed(2)) };
    });

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
        adjustStart(value);
      } else {
        adjustEnd(value);
      }
    };
    move(event.clientX);
    const onMove = (moveEvent) => move(moveEvent.clientX);
    const onUp = () => {
      target.releasePointerCapture?.(pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="trim-modal-backdrop">
      <div className="trim-modal">
        <header>
          <h3>Trim audio (optional)</h3>
          <p>Drag handles to isolate the verse you need. We keep the bars in sync with the trim.</p>
        </header>
        <audio
          controls
          src={audioUrl}
          className="trim-audio"
          onLoadedMetadata={(event) => {
            if (!audioDuration) {
              const duration = event.currentTarget.duration;
              if (Number.isFinite(duration)) {
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
