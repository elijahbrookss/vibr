import { formatTimestamp } from "../utils/time";

function VideoPreview({ videoUrl, videoRef, videoTrim, videoDuration }) {
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
          <strong>Final trim</strong>
          <div className="trim-track static">
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
  );
}

export default VideoPreview;
