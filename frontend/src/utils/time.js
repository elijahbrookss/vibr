export const formatTimestamp = (value, { milliseconds = false } = {}) => {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  if (!milliseconds) {
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  const ms = Math.round((value - Math.floor(value)) * 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
};

export const describeRange = (start, end) => {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Full track";
  return `${formatTimestamp(Math.max(0, start))} – ${formatTimestamp(Math.max(start, end))}`;
};
