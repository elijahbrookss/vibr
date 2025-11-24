import { formatTimestamp } from "../utils/time";

function LyricsPanel({
  visibleBars,
  extraCount,
  setEditingIndex,
  editingIndex,
  handleBarTextChange,
  wordPhases,
  videoRef,
  removeBar,
  addBar,
  applyChanges,
  loading,
  showAllBars,
  onToggleAll,
  totalBars,
}) {
  return (
    <div className="lyrics-panel">
      <div className="panel-header">
        <div>
          <h3>Rendered lyrics</h3>
          <p className="subtitle">Double-tap to edit a bar and keep everything in sync.</p>
        </div>
        <div className="panel-controls">
          <button className="ghost-button" onClick={onToggleAll} type="button" disabled={!totalBars || totalBars <= 4}>
            {showAllBars ? "Collapse view" : `Show all (${totalBars})`}
          </button>
          <button className="ghost-button" onClick={addBar} type="button">
            + Add lyric
          </button>
        </div>
      </div>
      <ol>
        {visibleBars.length === 0 && <li className="lyric-tip">Generate a take to unlock the lyric grid.</li>}
        {visibleBars.map((bar, idx) => {
          const wordsSource =
            bar.words && bar.words.length
              ? bar.words
              : (bar.text ?? "")
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((text) => ({ text }));
          const phase = wordPhases[idx] ?? "group";
          const mainWords = wordsSource.slice(0, 5);
          const overflowWord = wordsSource[5];
          const displayWords = phase === "single" && overflowWord ? [overflowWord] : mainWords;
          const isEditing = editingIndex === idx;
          return (
            <li key={`${bar.start}-${idx}`} className="lyric-bar">
              <div className="timestamp-row">
                <button
                  type="button"
                  className="seek"
                  onClick={() => {
                    if (videoRef.current) videoRef.current.currentTime = Math.max(0, bar.start);
                  }}
                >
                  Start {formatTimestamp(bar.start)}
                </button>
                <span className="timestamp">End {formatTimestamp(bar.end)}</span>
              </div>
              <div className={`lyric-edit ${isEditing ? "active" : ""}`}>
                {isEditing ? (
                  <textarea
                    value={bar.text}
                    onChange={(event) => handleBarTextChange(idx, event.target.value)}
                    rows={2}
                    placeholder="Type lyric copy"
                  />
                ) : (
                  <p onDoubleClick={() => setEditingIndex(idx)}>{bar.text || "Double-tap to edit lyric"}</p>
                )}
                <div className="lyric-actions">
                  <button className="ghost-button" onClick={() => setEditingIndex(isEditing ? null : idx)} type="button">
                    {isEditing ? "Done" : "Edit"}
                  </button>
                  <button className="ghost-button" onClick={() => removeBar(idx)} type="button">
                    Delete
                  </button>
                </div>
              </div>
              <div className="bar-words animated">
                {displayWords.map((word, idy) => (
                  <span
                    key={`${word.text}-${idy}`}
                    className="word-chip"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = Math.max(0, word.start ?? bar.start);
                      }
                    }}
                  >
                    {word.text}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
        {extraCount > 0 && <li className="lyric-note">+{extraCount} additional bars hidden above</li>}
      </ol>
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
