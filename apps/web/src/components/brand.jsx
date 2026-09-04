import { Disc } from "lucide-react";

/**
 * Kora wordmark, in Next Kode School's brand voice.
 *
 * The school's site sets its name in two weights with the second word in
 * gold, over a spaced-out uppercase "SCHOOL" line. The same structure is
 * reused here so Kora reads as part of that family rather than as an
 * unrelated product: the name, then the school beneath it in mono caps with
 * "Kode" carrying the gold.
 *
 * Deliberately no gradient, no glow, no oversized logo. The gold appears
 * twice on this element and nowhere else in the sidebar.
 */
export function Wordmark({ showSchool = true }) {
  return (
    <div className="wordmark">
      <span className="mark">
        <Disc size={15} strokeWidth={2} />
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
