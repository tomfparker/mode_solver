// Full-screen opaque loading screen with the rotating disc. Shown while the solver loads and
// for long solves (see App).

import disc from '../assets/disc.webp';

interface Props {
  title: string;
  detail: string;
  /** 0..1 for a determinate bar; omit for an indeterminate wait. */
  progress?: number;
  onCancel?: () => void;
}

const SEGMENTS = 20;

export function LoadingScreen({ title, detail, progress, onCancel }: Props) {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-label={`${title}. ${detail}`}>
      <img className="disc" src={disc} alt="" />
      <h1>{title}</h1>
      {progress !== undefined && (
        <div className="bar" aria-hidden>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span key={i} className={i < Math.round(progress * SEGMENTS) ? 'on' : ''} />
          ))}
        </div>
      )}
      <div className="detail">{detail}</div>
      {onCancel && (
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
