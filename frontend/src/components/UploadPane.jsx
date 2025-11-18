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
}) {
  const fileLabel = file?.name ?? "Drag a beat or browse files";
  const fileSize = file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "MP3 • WAV • M4A";
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
    </div>
  );
}

export default UploadPane;
