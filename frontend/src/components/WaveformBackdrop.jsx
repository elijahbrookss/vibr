function WaveformBackdrop({ points, selectionStart = 0, selectionEnd = 1 }) {
  if (!points || points.length === 0) {
    return <div className="waveform-placeholder" aria-hidden="true" />;
  }
  return (
    <div className="waveform" aria-hidden="true">
      {points.map((value, idx) => {
        const ratio = idx / points.length;
        const active = ratio >= selectionStart && ratio <= selectionEnd;
        return (
          <span
            key={`wave-${idx}`}
            className={`waveform-bar ${active ? "active" : ""}`}
            style={{
              height: `${20 + Math.min(1, value) * 80}%`,
              animationDelay: `${idx * 0.015}s`,
            }}
          />
        );
      })}
    </div>
  );
}

export default WaveformBackdrop;
