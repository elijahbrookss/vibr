import { useState } from "react";
import "./App.css";

function App() {
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!file) {
      setError("Please select an audio file first.");
      setStatus("");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    setError("");
    setStatus("Uploading audio...");
    setResult(null);
    setLoading(true);

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.detail || "Processing failed, please try again.");
      }
      const json = await response.json();
      setResult(json);
      setStatus("Lyric video ready! You can preview it below.");
    } catch (err) {
      setError(err.message);
      setStatus("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="portal">
      <h1>Lyric Video Generator</h1>
      <p>Upload an audio clip and get a timed lyric video plus lyrics file.</p>
      <form onSubmit={handleSubmit} className="upload-form">
        <label className="file-label">
          <span>
            {file ? file.name : "Choose audio file"}
          </span>
          <input type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? <span className="loader" aria-hidden="true" /> : "Generate lyric video"}
        </button>
      </form>
      {status && <p className="status success">{status}</p>}
      {error && <p className="status error">{error}</p>}
      {result && (
        <section className="results">
          <h2>Downloads</h2>
          <div className="links">
            <a href={result.video_url} target="_blank" rel="noreferrer">
              Download video
            </a>
            <a href={result.lyrics_url} target="_blank" rel="noreferrer">
              Download lyrics
            </a>
          </div>
          <div className="preview">
            <video crossOrigin="anonymous" controls src={result.video_url}>
              Your browser does not support HTML video.
            </video>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
