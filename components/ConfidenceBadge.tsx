import type { ConfidenceAssessment } from '@/lib/confidence/signals';
import { CONFIDENCE_DESCRIPTIONS, CONFIDENCE_LABELS } from '@/lib/confidence/signals';

/**
 * Confidence as a monospace label, not a coloured pill.
 *
 * Only "confirmed" gets the accent. If every level were coloured the colour
 * would stop carrying information, which is the failure mode of status pills
 * generally.
 */
const TONE: Record<ConfidenceAssessment['level'], string> = {
  confirmed: 'text-accent',
  likely: 'text-muted',
  possible: 'text-faint',
};

export function ConfidenceBadge({ confidence }: { confidence: ConfidenceAssessment }) {
  return (
    <span
      title={CONFIDENCE_DESCRIPTIONS[confidence.level]}
      className={`tag shrink-0 ${TONE[confidence.level]}`}
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
    <div className="space-y-2">
      <p className="tag">Why we think this</p>
      <ul className="space-y-1.5">
        {confidence.signals.map((signal) => (
          <li key={signal.id} className="flex items-start gap-2.5 text-sm text-muted">
            <span
              aria-hidden
              className={`mt-[0.45rem] h-px w-3 shrink-0 ${
                signal.weight < 0 ? 'bg-faint' : 'bg-accent'
              }`}
            />
            <span>{signal.explanation}</span>
          </li>
        ))}
      </ul>
      {confidence.cappedBy ? (
        <p className="border-l border-rule-strong pl-3 text-sm italic text-muted">
          {confidence.cappedBy}
        </p>
      ) : null}
    </div>
  );
}
