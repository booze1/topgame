import { useEffect, useState } from 'react';
import { generateArt } from '../lib/art';
import type { CardDef, Deck } from '../../shared/types';

interface CardArtProps {
  card: CardDef;
  deck: Deck;
}

/**
 * The picture at the top of a card: the fetched photograph when there is one,
 * and generated art when there is not. The generated version stays mounted
 * underneath the photo, so a slow or failing image never leaves a white hole.
 */
export function CardArt({ card, deck }: CardArtProps): JSX.Element {
  const [failed, setFailed] = useState(false);
  const art = generateArt(card.id, deck.theme);
  const gradientId = `art-${deck.id}-${card.id}`;
  const fit = card.fit ?? deck.art?.fit ?? 'cover';
  const showPhoto = Boolean(card.image) && !failed;
  // The flat band belongs to a contained photograph only. Without a photo the
  // card falls back to generated art, which should look the same in every deck
  // rather than becoming an empty pale rectangle.
  const contained = showPhoto && fit === 'contain';
  const band = contained ? (deck.art?.background ?? '#f4f6fb') : undefined;

  // A new photo path (deck switch, rematch) deserves a fresh attempt.
  useEffect(() => setFailed(false), [card.image]);

  return (
    <div className="card__art" style={band ? { background: band } : undefined}>
      {!contained && (
      <svg
        className="card__art-generated"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={art.gradientFrom} />
            <stop offset="1" stopColor={art.gradientTo} />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${gradientId})`} />
        <g transform={`rotate(${art.rotation} 50 50)`}>
          {art.blobs.map((blob, index) => (
            <circle
              key={index}
              cx={blob.cx}
              cy={blob.cy}
              r={blob.r}
              fill={blob.fill}
              opacity={blob.opacity}
            />
          ))}
        </g>
      </svg>
      )}

      {showPhoto ? (
        <img
          className="card__photo"
          src={card.image}
          alt={card.name}
          loading="lazy"
          decoding="async"
          // Anchors the crop for photographs that are not composed for a
          // letterbox; the deck loader validates the value.
          style={{
            objectFit: fit,
            ...(card.focus ? { objectPosition: card.focus } : {}),
          }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="card__glyph" aria-hidden="true">
          {card.emoji}
        </span>
      )}
    </div>
  );
}
