/**
 * Kora wordmark, in Next Kode School's brand voice.
 *
 * The mark is the school's own: gold braces around an N and a K whose stroke
 * is an upward arrow. It is served in two versions because the N is white on
 * the dark file and dark on the light one; CSS shows whichever matches the
 * theme, so only the visible image is fetched.
 *
 * Beneath the name, the school's structure is reused -- "Kode" carries the
 * gold, "SCHOOL" is spaced caps -- so Kora reads as part of that family.
 */
export function Wordmark({ showSchool = true }) {
  return (
    <div className="wordmark">
      <span className="mark" aria-hidden="true">
        <img className="on-dark" src="/brand/logo-dark.png" alt="" />
        <img className="on-light" src="/brand/logo-light.png" alt="" />
      </span>
      <span className="names">
        <span className="name">Kora</span>
        {showSchool && (
          <span className="school">
            Next <b>Kode</b> School
          </span>
        )}
      </span>
    </div>
  );
}
