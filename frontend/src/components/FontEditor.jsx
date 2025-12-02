const fontWeights = [400, 500, 600, 700, 800];

function FontEditor({ fontSettings, fontOptions, onChange, onUploadFont, uploading }) {
  const sampleStyle = {
    fontFamily: fontSettings.family,
    fontSize: `${fontSettings.size}px`,
    color: fontSettings.color,
    fontWeight: fontSettings.weight,
    lineHeight: 1.2,
  };

  return (
    <div className="font-editor">
      <div className="font-grid">
        <div className="font-control">
          <label>
            Font family
            <select
              value={fontSettings.option}
              onChange={(event) => {
                const option = fontOptions.find((candidate) => candidate.value === event.target.value);
                if (!option) return;
                onChange({
                  family: option.family,
                  option: option.value,
                  path: option.path ?? null,
                  url: option.url ?? null,
                  isCustom: Boolean(option.custom),
                });
              }}
            >
              {fontOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="font-control">
          <label>
            Font size
            <span className="font-value">{fontSettings.size}px</span>
          </label>
          <input
            type="range"
            min="48"
            max="120"
            value={fontSettings.size}
            onChange={(event) => onChange({ size: Number(event.target.value) })}
          />
        </div>
        <div className="font-control">
          <label>
            Font weight
            <select value={fontSettings.weight} onChange={(event) => onChange({ weight: Number(event.target.value) })}>
              {fontWeights.map((weight) => (
                <option key={weight} value={weight}>
                  {weight}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="font-control color-control">
          <label>Font color</label>
          <input
            type="color"
            value={fontSettings.color}
            onChange={(event) => onChange({ color: event.target.value })}
          />
        </div>
        <div className="font-control upload-control">
          <label>Upload custom font</label>
          <div className="font-upload-row">
            <input
              type="file"
              accept=".ttf,.otf,.woff,.woff2,.ttc"
              id="font-upload-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onUploadFont(file);
                }
                event.target.value = "";
              }}
            />
            <label className="ghost-button" htmlFor="font-upload-input">
              {uploading ? "Uploading..." : "Choose font file"}
            </label>
          </div>
          <p className="font-upload-hint">Add your own TTF/OTF/WOFF fonts for rendering and preview.</p>
        </div>
      </div>
      <div className="font-preview" aria-live="polite">
        <div className="font-preview-label">Live font preview</div>
        <div className="font-preview-card" style={sampleStyle}>
          VIBR is the best.
        </div>
        <p className="font-preview-hint">This sample reflects pending font choices only. Rendering uses these values when you click Generate.</p>
      </div>
    </div>
  );
}

export default FontEditor;
