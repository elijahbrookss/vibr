import { useRef, useState, useEffect } from "react";
import { formatTimestamp } from "../utils/time";
import WaveformBackdrop from "./WaveformBackdrop";

function VideoPreview({ videoUrl, videoRef, videoTrim, videoDuration, onTrimChange, waveformPoints }) {
  const trackRef = useRef(null);
  const [localTrim, setLocalTrim] = useState(videoTrim);
  const [isDragging, setIsDragging] = useState(false);

  // Sync local state when videoTrim prop changes
  useEffect(() => {
    setLocalTrim(videoTrim);
  }, [videoTrim]);

  const duration = Math.max(videoDuration, 0.01);
  const startPercent = (localTrim.start / duration) * 100;
  const endPercent = (localTrim.end / duration) * 100;

  const positionToValue = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return ratio * duration;
  };

  const adjustStart = (value) => {
    const newStart = Math.max(0, Math.min(value, localTrim.end - 0.1));
    setLocalTrim((prev) => ({ ...prev, start: Number(newStart.toFixed(2)) }));
  };

  const adjustEnd = (value) => {
    const newEnd = Math.min(duration, Math.max(value, localTrim.start + 0.1));
    setLocalTrim((prev) => ({ ...prev, end: Number(newEnd.toFixed(2)) }));
  };

  const beginHandleDrag = (handle) => (event) => {
    event.preventDefault();
    setIsDragging(true);
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    target.setPointerCapture(pointerId);

    const onMove = (moveEvent) => {
      const value = positionToValue(moveEvent.clientX);
      if (handle === "start") {
        adjustStart(value);
      } else {
        adjustEnd(value);
      }
    };

    const onUp = () => {
      setIsDragging(false);
      target.releasePointerCapture(pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  const handleApplyTrim = () => {
    onTrimChange?.(localTrim);
  };

  const hasChanges = localTrim.start !== videoTrim.start || localTrim.end !== videoTrim.end;

  return (
    <div className="preview-card">
      <div className="video-wrapper">
        {videoUrl ? (
          <video ref={videoRef} controls src={videoUrl} className="preview-video" />
        ) : (
          <div className="video-placeholder">
            <p>No render yet.</p>
            <p>Upload a track to see the motion graphics preview.</p>
          </div>
        )}
      </div>
      {videoUrl && (
        <div className="trim-panel">
          <div className="trim-panel-header">
            <strong>Final trim</strong>
            {hasChanges && (
              <button className="apply-trim-button" onClick={handleApplyTrim}>
                Apply trim
              </button>
            )}
          </div>
          <div className="trim-track live" ref={trackRef}>
            <div className="trim-track-inner">
              {waveformPoints && waveformPoints.length > 0 && (
                <WaveformBackdrop
                  points={waveformPoints}
                  selectionStart={localTrim.start / duration}
                  selectionEnd={localTrim.end / duration}
                />
              )}
            </div>
            <div
              className="trim-highlight"
              style={{
                left: `${startPercent}%`,
                width: `${Math.max(endPercent - startPercent, 0)}%`,
              }}
            />
            <div className="trim-handle start" style={{ left: `${startPercent}%` }} onPointerDown={beginHandleDrag("start")}>
              <span>{formatTimestamp(localTrim.start)}</span>
            </div>
            <div className="trim-handle end" style={{ left: `${endPercent}%` }} onPointerDown={beginHandleDrag("end")}>
              <span>{formatTimestamp(localTrim.end)}</span>
            </div>
          </div>
          <div className="trim-labels">
            <span>{formatTimestamp(localTrim.end - localTrim.start)} selected</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default VideoPreview;
