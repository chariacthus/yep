import type { ConfidenceAssessment } from '@/lib/confidence/signals';
import { CONFIDENCE_DESCRIPTIONS, CONFIDENCE_LABELS } from '@/lib/confidence/signals';

/**
 * Confidence as a tinted capsule.
 *
 * Only "confirmed" carries the accent. If every level were coloured the colour
 * would stop meaning anything, which is the usual failure of status pills.
 */
const TONE: Record<ConfidenceAssessment['level'], string> = {
  confirmed: 'bg-accent/18 text-accent-soft',
  likely: 'bg-glass/10 text-muted',
  possible: 'bg-glass/[0.06] text-faint',
};

export function ConfidenceBadge({ confidence }: { confidence: ConfidenceAssessment }) {
  return (
    <span
      title={CONFIDENCE_DESCRIPTIONS[confidence.level]}
      className={`pill shrink-0 whitespace-nowrap ${TONE[confidence.level]}`}
    >
      {CONFIDENCE_LABELS[confidence.level]}
    </span>
  );
}

/**
 * The reasoning behind a level, in full.
 *
 * Showing this is not decoration. A tool that says "this is you" without saying
 * why is asking to be believed; one that lists its reasons can be argued with,
 * which is the correct relationship here.
 */
export function ConfidenceReasons({ confidence }: { confidence: ConfidenceAssessment }) {
  return (
    <div>
      <p className="label mb-2.5">Why we think this</p>
      <ul className="space-y-2">
        {confidence.signals.map((signal) => (
          <li key={signal.id} className="flex items-start gap-2.5 text-[0.9375rem] text-muted">
            <span
              aria-hidden
              className={`mt-[0.5rem] h-1.5 w-1.5 shrink-0 rounded-full ${
                signal.weight < 0 ? 'bg-faint/60' : 'bg-accent'
              }`}
            />
            <span>{signal.explanation}</span>
          </li>
        ))}
      </ul>
      {confidence.cappedBy ? (
        <p className="well mt-3 px-3.5 py-2.5 text-[0.875rem] text-muted">{confidence.cappedBy}</p>
      ) : null}
    </div>
  );
}
