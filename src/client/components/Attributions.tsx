import type { Deck } from '../../shared/types';

interface AttributionsProps {
  decks: Deck[];
  onClose: () => void;
}

/**
 * Photo credits.
 *
 * The fetch script pulls lead images from Wikipedia along with their licence
 * and photographer, and this screen shows them. Most of these images are used
 * under Creative Commons licences that require attribution, so this page is
 * part of using them properly, not a nicety.
 */
export function Attributions({ decks, onClose }: AttributionsProps): JSX.Element {
  const credited = decks
    .map((deck) => ({ deck, cards: deck.cards.filter((card) => card.credit) }))
    .filter((entry) => entry.cards.length > 0);

  return (
    <main className="credits">
      <header className="credits__head">
        <h1>Photo credits</h1>
        <button type="button" className="button button--small" onClick={onClose}>
          Back
        </button>
      </header>

      {credited.length === 0 ? (
        <p className="notice">
          No photographs have been fetched yet, so every card is showing generated art. Run{' '}
          <code>npm run fetch-images</code> to pull the real photos from Wikipedia along with their
          licences, then reload.
        </p>
      ) : (
        <>
          <p className="credits__intro">
            Card photographs come from Wikipedia and Wikimedia Commons. Each is listed below with
            its author and licence; follow a link for the original file and full terms.
          </p>
          {credited.map(({ deck, cards }) => (
            <section key={deck.id} className="credits__deck">
              <h2>
                <span aria-hidden="true">{deck.emoji}</span> {deck.name}
              </h2>
              <ul>
                {cards.map((card) => (
                  <li key={card.id}>
                    <strong>{card.name}</strong>
                    <span>
                      {card.credit!.artist} · {card.credit!.licence}
                    </span>
                    <a href={card.credit!.sourceUrl} target="_blank" rel="noreferrer noopener">
                      source
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
