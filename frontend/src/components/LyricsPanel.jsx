import { formatTimestamp } from "../utils/time";

function LyricsPanel({
  words,
  visibleChunks,
  chunkCount,
  onWordChange,
  onWordTimeChange,
  onInsertAfter,
  onDeleteWord,
  activeWordId,
  wordError,
  rowErrors,
  overlayStyle,
  videoRef,
  applyChanges,
  loading,
  logs = [],
  onClearLogs,
}) {
  const seekTo = (time) => {
    if (videoRef?.current) {
      videoRef.current.currentTime = Math.max(0, time ?? 0);
    }
  };
  const clearLogs = () => {
    if (onClearLogs) onClearLogs();
  };

  const hasWords = words.length > 0;
  return (
    <div className="lyrics-panel" style={overlayStyle}>
      <div className="panel-header">
        <div>
          <h3>Rendered lyrics</h3>
          <p className="subtitle">Edit individual words; rendering groups them into four-word chunks.</p>
        </div>
        {wordError && <div className="word-error">{wordError}</div>}
      </div>
      <div className="word-grid" aria-live="polite">
        <div className="word-grid-header">
          <span>Word</span>
          <span>Start (s)</span>
          <span>End (s)</span>
          <span className="word-actions-col">Actions</span>
        </div>
        {!hasWords && <p className="lyric-tip">Generate a take to unlock the lyric grid.</p>}
        <div className="word-grid-body">
          {words.map((word, idx) => (
            <div className="word-row-wrapper" key={word.id}>
              <div
                className={`word-row ${activeWordId === word.id ? "active" : ""}`}
                onClick={() => seekTo(word.start)}
              >
                <input
                  className="word-input"
                  value={word.text}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onWordChange(word.id, event.target.value)}
                  aria-label={`Edit word ${word.text}`}
                />
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  inputMode="decimal"
                  className="time-input"
                  value={Number.isFinite(word.start) ? word.start.toFixed(3) : "0.000"}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onWordTimeChange(word.id, "start", event.target.value)}
                  aria-label={`Set start for ${word.text}`}
                />
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  inputMode="decimal"
                  className="time-input"
                  value={Number.isFinite(word.end) ? word.end.toFixed(3) : "0.000"}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onWordTimeChange(word.id, "end", event.target.value)}
                  aria-label={`Set end for ${word.text}`}
                />
                <div className="word-actions">
                  {idx < words.length - 1 ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        onInsertAfter(word.id);
                      }}
                      aria-label="Insert a new word after this"
                    >
                      +
                    </button>
                  ) : (
                    <span className="word-actions-placeholder" aria-hidden="true">
                      ·
                    </span>
                  )}
                  <button
                    type="button"
                    className="ghost delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteWord(word.id);
                    }}
                    aria-label={`Delete ${word.text}`}
                  >
                    ×
                  </button>
                </div>
              </div>
              {rowErrors?.[word.id] && <div className="row-error">{rowErrors[word.id]}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="chunk-preview">
        <div className="chunk-preview-header">
          <h4>Display chunks</h4>
          {chunkCount > visibleChunks.length && (
            <span className="lyric-note">Showing {visibleChunks.length} of {chunkCount}</span>
          )}
        </div>
        <div className="chunk-list">
          {visibleChunks.map((chunk, idx) => {
            const isActive = chunk.words?.some((w) => w.id === activeWordId);
            return (
              <div key={`${chunk.start}-${idx}`} className={`chunk-card ${isActive ? "active" : ""}`}>
                <div className="chunk-times">
                  <span>{formatTimestamp(chunk.start, { milliseconds: true })}</span>
                  <span>{formatTimestamp(chunk.end, { milliseconds: true })}</span>
                </div>
                <div className={`bar-words animated anim-${overlayStyle?.["--overlay-animation"]}`}>
                  {chunk.words?.map((word) => (
                    <span key={word.id} className={`word-chip ${activeWordId === word.id ? "active" : ""}`}>
                      {word.text}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="client-log">
        <div className="client-log-header">
            <h4>Activity & errors</h4>
            <div className="client-log-actions">
              <span className="client-log-hint">Newest first. Keeps the last 40 events.</span>
              <button type="button" className="ghost" onClick={clearLogs} disabled={!logs.length}>
                Clear
              </button>
            </div>
        </div>
        {logs.length === 0 ? (
          <p className="lyric-tip">Actions, warnings, and API errors will appear here.</p>
        ) : (
          <ul className="client-log-list" aria-live="polite">
            {logs.slice(0, 12).map((entry) => (
              <li key={entry.id} className={`client-log-entry level-${entry.level}`}>
                <div className="client-log-meta">
                  <span className="client-log-level">{entry.level}</span>
                  <span className="client-log-time">{new Date(entry.at).toLocaleTimeString()}</span>
                </div>
                <div className="client-log-message">{entry.message}</div>
                {entry.meta && (
                  <pre className="client-log-meta-block">{JSON.stringify(entry.meta, null, 2)}</pre>
                )}
              </li>
            ))}
          </ul>
        )}
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
