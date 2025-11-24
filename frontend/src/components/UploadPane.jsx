import { describeRange } from "../utils/time";

function UploadPane({
  file,
  loading,
  onFileChange,
  onSubmit,
  status,
  error,
  onOpenTrimmer,
  trimSelection,
  statusEvents = [],
}) {
  const fileLabel = file?.name ?? "Drag a beat or browse files";
  const fileSize = file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "MP3 • WAV • M4A";
  const formatEventTime = (timestamp) => {
    if (!timestamp) return "";
    try {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (err) {
      return "";
    }
  };
  return (
    <div className="upload-pane">
      <label className={`file-drop ${file ? "has-file" : ""}`}>
        <input type="file" accept="audio/*" onChange={onFileChange} />
        <div>
          <p className="file-title">{fileLabel}</p>
          <p className="file-meta">{fileSize}</p>
        </div>
      </label>
      <div className="upload-actions">
        <button type="button" className="ghost-button" onClick={onOpenTrimmer} disabled={!file}>
          {trimSelection?.active ? "Adjust trim" : "Trim intro"}
        </button>
        <button className="primary" type="button" onClick={onSubmit} disabled={loading || !file}>
          {loading ? "Rendering your reel..." : file ? "Generate lyric video" : "Upload audio"}
        </button>
      </div>
      <p className="trim-note">{trimSelection?.active ? describeRange(trimSelection.start, trimSelection.end) : "Full track selected"}</p>
      {status && <p className="status success">{status}</p>}
      {error && <p className="status error">{error}</p>}
      {statusEvents.length > 0 && (
        <div className="status-feed">
          <p className="status-heading">Workflow status</p>
          <ol>
            {statusEvents.map((event) => (
              <li key={event.stage} className={`status-item ${event.state}`}>
                <span className="status-dot" aria-hidden />
                <div className="status-body">
                  <div className="status-row">
                    <span className="status-label">{event.label}</span>
                    <span className="status-time">{formatEventTime(event.timestamp)}</span>
                  </div>
                  {event.detail && <p className="status-detail">{event.detail}</p>}
                  {event.state === "running" && <span className="status-pill">In progress</span>}
                  {event.state === "complete" && <span className="status-pill complete">Done</span>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export default UploadPane;
