type PlayBackdropProps = {
  lobby: boolean
}

export function PlayBackdrop({ lobby }: PlayBackdropProps) {
  return (
    <div className={lobby ? 'play-decor is-lobby' : 'play-decor'} aria-hidden>
      <svg className="play-pattern">
        <defs>
          <pattern id="play-cloth" width="300" height="300" patternUnits="userSpaceOnUse">
            <path
              d="M46 72c12-18 32-12 34 8-18 6-28 2-34-8z"
              fill="#2f5d4a"
              fillOpacity="0.14"
            />
            <path
              d="M46 70c18-4 28 6 24 16"
              fill="none"
              stroke="#24543f"
              strokeOpacity="0.16"
              strokeWidth="1"
            />
            <path
              d="M214 196c10-20 30-10 26 12-18 4-24-2-26-12z"
              fill="#3f7a61"
              fillOpacity="0.16"
            />
            <path
              d="M132 38c7-12 20-7 18 7-12 3-16 0-18-7z"
              fill="#2f5d4a"
              fillOpacity="0.12"
            />
            <path
              d="M78 228c14 2 22-8 16-18"
              fill="none"
              stroke="#2f5d4a"
              strokeOpacity="0.14"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <path
              d="M248 84c8 8 8 18 0 24"
              fill="none"
              stroke="#c4a574"
              strokeOpacity="0.45"
              strokeWidth="1.15"
              strokeLinecap="round"
            />
            <circle cx="176" cy="92" r="1.8" fill="#c4a574" fillOpacity="0.55" />
            <circle cx="98" cy="164" r="1.35" fill="#2f5d4a" fillOpacity="0.22" />
            <circle cx="236" cy="246" r="1.6" fill="#e0b45c" fillOpacity="0.5" />
            <circle cx="40" cy="150" r="1.2" fill="#c4a574" fillOpacity="0.4" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#play-cloth)" />
      </svg>
      {lobby ? (
        <>
          <Sprig className="play-sprig play-sprig-a" flower />
          <Branch className="play-sprig play-sprig-b" />
          <Sprig className="play-sprig play-sprig-c" />
          <Branch className="play-sprig play-sprig-d" flower />
          <LooseLeaf className="play-leaf play-leaf-a" />
          <LooseLeaf className="play-leaf play-leaf-b" />
          <LooseLeaf className="play-leaf play-leaf-c" />
        </>
      ) : null}
    </div>
  )
}

function Sprig({ className, flower }: { className: string; flower?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 200 320" fill="none">
      <path
        d="M104 302C100 232 96 156 102 46"
        stroke="#24543f"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M102 248C68 226 28 204 14 158C42 166 76 198 102 248Z" fill="#3f7a61" />
      <path
        d="M102 244C74 222 42 202 28 168"
        stroke="#1f4634"
        strokeWidth="0.8"
        strokeOpacity="0.45"
      />
      <path d="M104 206C142 188 184 162 196 114C164 128 128 166 104 206Z" fill="#2f5d4a" />
      <path
        d="M106 200C138 182 172 158 186 124"
        stroke="#1f4634"
        strokeWidth="0.8"
        strokeOpacity="0.4"
      />
      <path d="M102 156C58 140 22 108 16 62C48 78 78 118 102 156Z" fill="#4e8f6e" />
      <path
        d="M100 152C66 136 36 110 28 74"
        stroke="#1f4634"
        strokeWidth="0.8"
        strokeOpacity="0.35"
      />
      <path d="M104 112C140 96 172 68 168 28C140 48 118 80 104 112Z" fill="#3f7a61" />
      <path d="M102 78C74 60 46 42 42 16C64 28 86 50 102 78Z" fill="#2f5d4a" fillOpacity="0.9" />
      {flower ? <Blossom cx={104} cy={40} /> : (
        <circle cx="103" cy="42" r="6" fill="#e7c56a" />
      )}
    </svg>
  )
}

function Branch({ className, flower }: { className: string; flower?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 260 200" fill="none">
      <path
        d="M28 168C78 150 130 118 214 46"
        stroke="#24543f"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M78 156C52 118 36 78 48 36C78 62 86 112 78 156Z" fill="#3f7a61" />
      <path
        d="M74 148C56 116 46 82 54 48"
        stroke="#1f4634"
        strokeWidth="0.8"
        strokeOpacity="0.4"
      />
      <path d="M128 128C112 86 128 48 162 22C150 66 140 100 128 128Z" fill="#2f5d4a" />
      <path d="M168 96C176 58 206 32 242 28C214 52 186 74 168 96Z" fill="#4e8f6e" />
      <path
        d="M170 90C186 62 214 40 236 34"
        stroke="#1f4634"
        strokeWidth="0.8"
        strokeOpacity="0.35"
      />
      <path d="M196 72C214 64 236 70 248 88C226 84 208 78 196 72Z" fill="#c4a574" fillOpacity="0.85" />
      {flower ? <Blossom cx={214} cy={42} /> : null}
    </svg>
  )
}

function LooseLeaf({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 80 110" fill="none">
      <path d="M40 100C34 68 22 36 40 8C58 36 48 70 40 100Z" fill="#3f7a61" />
      <path
        d="M40 96C36 64 28 36 40 14"
        stroke="#1f4634"
        strokeWidth="0.9"
        strokeOpacity="0.4"
      />
      <path d="M40 70C28 58 18 40 22 24" stroke="#24543f" strokeWidth="0.7" strokeOpacity="0.28" />
    </svg>
  )
}

function Blossom({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      {[0, 72, 144, 216, 288].map((deg) => (
        <ellipse key={deg} cx="0" cy="-8" rx="3.4" ry="5.6" fill="#f3dd9a" transform={`rotate(${deg})`} />
      ))}
      <circle r="3.3" fill="#e0aa45" />
    </g>
  )
}
