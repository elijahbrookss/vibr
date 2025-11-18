const fontFamilies = ["Inter", "Roboto", "Montserrat", "Space Grotesk", "Avenir"];

function FontEditor({ fontSettings, onChange }) {
  return (
    <div className="font-editor">
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
      <div className="font-control color-control">
        <label>Font color</label>
        <input type="color" value={fontSettings.color} onChange={(event) => onChange({ color: event.target.value })} />
      </div>
    </div>
  );
}

export default FontEditor;
