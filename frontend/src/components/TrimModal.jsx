import WaveformBackdrop from "./WaveformBackdrop";
import { formatTimestamp } from "../utils/time";

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
}) {
  if (!open) return null;
  const sliderMax = Math.max(audioDuration || modalRange.end || 0.01, 0.01);
  const startPercent = (modalRange.start / sliderMax) * 100;
  const endPercent = (modalRange.end / sliderMax) * 100;

  const adjustStart = (value) =>
    setModalRange((prev) => ({ ...prev, start: Math.min(value, (prev.end ?? sliderMax) - 0.05) }));
  const adjustEnd = (value) =>
    setModalRange((prev) => ({ ...prev, end: Math.max(value, (prev.start ?? 0) + 0.05) }));

  const selectionStartRatio = modalRange.start / sliderMax;
  const selectionEndRatio = modalRange.end / sliderMax;

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
        <div className="trim-track live">
          <WaveformBackdrop points={waveformPoints} selectionStart={selectionStartRatio} selectionEnd={selectionEndRatio} />
          <div
            className="trim-highlight"
            style={{
              left: `${startPercent}%`,
              width: `${endPercent - startPercent}%`,
            }}
          />
          <div className="trim-handle start" style={{ left: `${startPercent}%` }}>
            <span>{formatTimestamp(modalRange.start)}</span>
          </div>
          <div className="trim-handle end" style={{ left: `${endPercent}%` }}>
            <span>{formatTimestamp(modalRange.end)}</span>
          </div>
          <input
            type="range"
            className="range-input start"
            min="0"
            max={sliderMax}
            step="0.01"
            value={modalRange.start}
            onChange={(event) => adjustStart(Number(event.target.value))}
          />
          <input
            type="range"
            className="range-input end"
            min="0"
            max={sliderMax}
            step="0.01"
            value={modalRange.end}
            onChange={(event) => adjustEnd(Number(event.target.value))}
          />
        </div>
        <div className="trim-modal-actions">
          <div>
            <p className="trim-duration-text">{formatTimestamp(modalRange.end - modalRange.start)} selected</p>
            <button className="ghost-button" type="button" onClick={() => setModalRange({ start: 0, end: sliderMax })}>
              Use full track
            </button>
          </div>
          <div className="trim-buttons">
            <button className="ghost-button" type="button" onClick={onClose}>
              Close
            </button>
            <button className="primary" type="button" onClick={applyTrim}>
              Apply trim
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TrimModal;
