import { Link } from 'react-router-dom'
import { games } from '../lib/games'
import { assetUrl } from '../lib/assetUrl'

export function GamesPage() {
  return (
    <section className="game-shell mx-auto w-full max-w-lg px-4 pb-16 pt-2 sm:px-6">
      <h1 className="font-display rise-in text-5xl leading-none text-[var(--ink)] sm:text-6xl">
        小游戏
      </h1>
      <p className="rise-in rise-in-delay-1 mt-3 max-w-xs text-sm leading-relaxed text-[var(--ink-soft)]">
        两个人的闲时，随便点开一局。
      </p>

      <ul className="game-grid rise-in rise-in-delay-2 mt-8">
        {games.map((game, i) => (
          <li
            key={game.id}
            className={`game-tile rise-in ${i % 2 === 1 ? 'is-offset' : ''}`}
            style={{
              animationDelay: `${0.05 * i}s`,
              ['--tilt' as string]: i % 2 === 0 ? '-1.2deg' : '1.4deg',
            }}
          >
            <Link to={game.path} className="game-tile-link">
              <div className="game-tile-media">
                <img
                  src={assetUrl(game.cover)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span className="game-tile-tag">{game.tag}</span>
              </div>
              <h2 className="game-tile-title">{game.title}</h2>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
