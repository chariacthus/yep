import type { ConfidenceAssessment } from '@/lib/confidence/signals';
import { CONFIDENCE_DESCRIPTIONS, CONFIDENCE_LABELS } from '@/lib/confidence/signals';

const TONE: Record<ConfidenceAssessment['level'], string> = {
  verified: 'border-verified/40 text-verified',
  likely: 'border-likely/40 text-likely',
  possible: 'border-possible/40 text-possible',
};

export function ConfidenceBadge({ confidence }: { confidence: ConfidenceAssessment }) {
  return (
    <span
      title={CONFIDENCE_DESCRIPTIONS[confidence.level]}
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[confidence.level]}`}
    >
      {CONFIDENCE_LABELS[confidence.level]}
    </span>
  );
}

/**
 * The reasoning behind a confidence level, in full.
 *
 * Showing this is not decoration. A tool that tells somebody "this is you"
 * without saying why is asking to be believed; one that lists its reasons can
 * be argued with, which is the correct relationship here.
 */
export function ConfidenceReasons({ confidence }: { confidence: ConfidenceAssessment }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">
        Why we think this
      </p>
      <ul className="space-y-1.5">
        {confidence.signals.map((signal) => (
          <li key={signal.id} className="flex items-start gap-2 text-sm text-muted">
            <span
              aria-hidden
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                signal.weight < 0 ? 'bg-faint' : 'bg-accent'
              }`}
            />
            <span>{signal.explanation}</span>
          </li>
        ))}
      </ul>
      {confidence.cappedBy ? (
        <p className="rounded-md bg-raised px-3 py-2 text-sm text-muted">{confidence.cappedBy}</p>
      ) : null}
    </div>
  );
}
