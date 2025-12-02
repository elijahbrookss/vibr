function LyricsPanel({
  words,
  onWordChange,
  onWordTimeChange,
  onInsertAfter,
  onDeleteWord,
  activeWordId,
  wordError,
  rowErrors,
  videoRef,
  applyChanges,
  loading,
}) {
  const seekTo = (time) => {
    if (videoRef?.current) {
      videoRef.current.currentTime = Math.max(0, time ?? 0);
    }
  };
  const hasWords = words.length > 0;
  return (
    <div className="lyrics-panel">
      <div className="panel-header">
        <div>
          <h3>Rendered lyrics</h3>
          <p className="subtitle">Edit individual words; rendering groups them into four-word chunks.</p>
        </div>
        {wordError && <div className="word-error">{wordError}</div>}
      </div>
      <div className="word-grid" aria-live="polite">
        <div className="word-grid-header">
          <span className="col-word">Word</span>
          <span className="col-time">Start</span>
          <span className="col-time">End</span>
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
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  className="time-input"
                  value={Number.isFinite(word.start) ? word.start.toFixed(2) : "0.00"}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onWordTimeChange(word.id, "start", event.target.value)}
                  aria-label={`Set start for ${word.text}`}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  className="time-input"
                  value={Number.isFinite(word.end) ? word.end.toFixed(2) : "0.00"}
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
