/**
 * ShimmeringText — a label with a highlight sweeping across it.
 *
 * Follows the ElevenLabs UI ShimmeringText API.
 *
 * Used for the gap between "question sent" and "first token arrives", which
 * on a laptop running a local model can be several seconds. Without
 * something here the app looks frozen, and the honest states differ: the
 * notes are being searched, then the model is writing. Saying which is
 * happening is more useful than a generic spinner.
 *
 * The animation is disabled under prefers-reduced-motion, where it falls
 * back to plain muted text.
 */

export function ShimmeringText({ children, className = "", ...props }) {
  return (
    <span className={`shimmer ${className}`} {...props}>
      {children}
    </span>
  );
}

export function ThinkingIndicator({ stage = "searching" }) {
  const label = stage === "writing" ? "Writing the answer" : "Searching your notes";

  return (
    <div className="thinking" role="status" aria-live="polite">
      <span className="thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <ShimmeringText>{label}</ShimmeringText>
    </div>
  );
}
