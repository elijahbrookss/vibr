function EmptyState({ title, body, buttonLabel, onAction }) {
  return (
    <div className="empty-state">
      <h4>{title}</h4>
      <p>{body}</p>
      {buttonLabel && (
        <button className="ghost-button" type="button" onClick={onAction}>
          {buttonLabel}
        </button>
      )}
    </div>
  );
}

export default EmptyState;
