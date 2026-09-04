/**
 * Kora wordmark, in Next Kode School's brand voice.
 *
 * The mark is the school's own: gold braces around an N and a K whose stroke
 * is an upward arrow. Two files because the N is white on the dark version
 * and dark on the light one; CSS shows the one that matches the theme.
 *
 * The school line sits under the name at the same width, not spread across
 * the sidebar: it is a caption to "Kora", not a second wordmark.
 *
 * `compact` renders the mark alone, for the collapsed rail.
 */
export function Wordmark({ compact = false }) {
  return (
    <div className={`wordmark ${compact ? "compact" : ""}`}>
      <span className="mark" aria-hidden="true">
        <img className="on-dark" src="/brand/logo-dark.png" alt="" />
        <img className="on-light" src="/brand/logo-light.png" alt="" />
      </span>
      {!compact && (
        <span className="names">
          <span className="name">Kora</span>
          <span className="school">
            Next <b>Kode</b> School
          </span>
        </span>
      )}
    </div>
  );
}
