function ExperienceCard({ eyebrow, title, hint, children, isLocked = false, lockMessage }) {
  return (
    <section className={`experience-card ${isLocked ? "is-locked" : ""}`}>
      <header>
        <p className="eyebrow">{eyebrow}</p>
        <div>
          <h2>{title}</h2>
          {hint && <p className="card-hint">{hint}</p>}
        </div>
      </header>
      <div className="card-body">
        {isLocked && (
          <div className="locked-overlay">
            <p>{lockMessage ?? "Complete the previous step to unlock"}</p>
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

export default ExperienceCard;
