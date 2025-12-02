const fontFamilies = ["Inter", "Roboto", "Montserrat", "Space Grotesk", "Avenir"];
const fontWeights = [400, 500, 600, 700, 800];

function FontEditor({ fontSettings, onChange }) {
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
            <select value={fontSettings.family} onChange={(event) => onChange({ family: event.target.value })}>
              {fontFamilies.map((family) => (
                <option key={family} value={family}>
                  {family}
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
