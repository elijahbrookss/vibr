import { formatTimestamp } from "../utils/time";

function LyricsPanel({ words, visibleChunks, chunkCount, onWordChange, videoRef, applyChanges, loading }) {
  return (
    <div className="lyrics-panel">
      <div className="panel-header">
        <div>
          <h3>Rendered lyrics</h3>
          <p className="subtitle">Edit individual words; rendering groups them into four-word chunks.</p>
        </div>
      </div>
      <div className="word-grid">
        <div className="word-grid-header">
          <span>Word</span>
          <span>Start</span>
          <span>End</span>
        </div>
        {words.length === 0 && <p className="lyric-tip">Generate a take to unlock the lyric grid.</p>}
        {words.map((word) => (
          <div key={word.id} className="word-row">
            <input
              className="word-input"
              value={word.text}
              onChange={(event) => onWordChange(word.id, event.target.value)}
              aria-label={`Edit word ${word.text}`}
            />
            <button
              type="button"
              className="seek"
              onClick={() => {
                if (videoRef.current) videoRef.current.currentTime = Math.max(0, word.start ?? 0);
              }}
            >
              {formatTimestamp(word.start ?? 0)}
            </button>
            <span className="timestamp">{formatTimestamp(word.end ?? 0)}</span>
          </div>
        ))}
      </div>
      <div className="chunk-preview">
        <div className="chunk-preview-header">
          <h4>Display chunks</h4>
          {chunkCount > visibleChunks.length && (
            <span className="lyric-note">Showing {visibleChunks.length} of {chunkCount}</span>
          )}
        </div>
        <div className="chunk-list">
          {visibleChunks.map((chunk, idx) => (
            <div key={`${chunk.start}-${idx}`} className="chunk-card">
              <div className="chunk-times">
                <span>{formatTimestamp(chunk.start)}</span>
                <span>{formatTimestamp(chunk.end)}</span>
              </div>
              <div className="bar-words animated">
                {chunk.words?.map((word) => (
                  <span key={word.id} className="word-chip">
                    {word.text}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="update-actions">
        <button className="primary" onClick={applyChanges} disabled={loading}>
          {loading ? "Updating..." : "Update video & lyrics"}
        </button>
        <span className="update-note">Every call rewrites the final render.</span>
      </div>
    </div>
  );
}

export default LyricsPanel;
