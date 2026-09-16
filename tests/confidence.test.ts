import { describe, expect, it } from 'vitest';
import { assessConfidence, THRESHOLD_CONFIRMED } from '@/lib/confidence/score';
import { commonNamePenalty, MAX_COMMON_NAME_PENALTY } from '@/lib/confidence/names';

/**
 * These tests guard the caps, not the arithmetic.
 *
 * The score is advisory and can be retuned. The caps are the product promise:
 * the scanner must never tell somebody "this is you" on evidence that cannot
 * support it. Each test below corresponds to a way that could go wrong.
 */

describe('name-only findings', () => {
  it('can never exceed "possible", however many other signals pile up', () => {
    const result = assessConfidence({
      signals: ['name_exact', 'name_plus_locality', 'profile_corroborates_name'],
      nameOnly: true,
      nameSearched: 'Wilhelmina Featherstonehaugh',
    });

    expect(result.level).toBe('possible');
    expect(result.cappedBy).toMatch(/name alone/i);
  });

  it('stays capped even when the raw score clears the confirmed threshold', () => {
    const result = assessConfidence({
      signals: ['email_exact', 'name_exact'],
      nameOnly: true,
    });

    expect(result.score).toBeGreaterThanOrEqual(THRESHOLD_CONFIRMED);
    expect(result.level).toBe('possible');
  });
});

describe('username-only findings', () => {
  it('is only "possible" without corroboration', () => {
    const result = assessConfidence({
      signals: ['username_exact'],
      nameOnly: false,
      usernameOnly: true,
    });

    expect(result.level).toBe('possible');
    expect(result.cappedBy).toMatch(/username/i);
  });

  it('rises to "likely" — but never "confirmed" — once corroborated', () => {
    const result = assessConfidence({
      signals: ['username_exact', 'linked_account_verified', 'profile_corroborates_email'],
      nameOnly: false,
      usernameOnly: true,
    });

    expect(result.level).toBe('likely');
  });
});

describe('the confirmed level', () => {
  it('is reached by an exact match on an identifier that was entered', () => {
    const exact = assessConfidence({ signals: ['email_exact'], nameOnly: false });
    expect(exact.level).toBe('confirmed');

    const hashed = assessConfidence({ signals: ['email_hash_exact'], nameOnly: false });
    expect(hashed.level).toBe('confirmed');
  });

  it('cannot be reached by weak signals accumulating', () => {
    const accumulated = assessConfidence({
      signals: [
        'profile_corroborates_email',
        'profile_corroborates_name',
        'linked_account_verified',
      ],
      nameOnly: false,
    });

    expect(accumulated.score).toBeGreaterThanOrEqual(THRESHOLD_CONFIRMED);
    expect(accumulated.level).toBe('likely');
    expect(accumulated.cappedBy).toMatch(/exactly/i);
  });

  it('describes the match only, and says nothing about who owns the address', () => {
    // A breach really does contain the address that was typed. Whether that
    // address belongs to the person typing it is a separate question, answered
    // once at the top of the report rather than folded in here.
    const result = assessConfidence({ signals: ['email_exact'], nameOnly: false });

    expect(result.level).toBe('confirmed');
    expect(result.signals.map((item) => item.explanation).join(' ')).toMatch(
      /exact email address you entered/i,
    );
  });
});

describe("the person's own verdict", () => {
  it('overrides everything when they confirm a result', () => {
    const result = assessConfidence({
      signals: ['name_exact'],
      nameOnly: true,
      userVerdict: 'confirmed',
    });

    expect(result.level).toBe('confirmed');
    expect(result.signals.some((signal) => signal.id === 'user_confirmed')).toBe(true);
  });

  it('sets a result aside when they reject it', () => {
    const result = assessConfidence({
      signals: ['email_exact'],
      nameOnly: false,
      userVerdict: 'rejected',
    });

    expect(result.level).toBe('possible');
    expect(result.cappedBy).toMatch(/not you/i);
  });
});

describe('the common-name penalty', () => {
  it('penalises a name where both halves are common', () => {
    expect(commonNamePenalty('John Smith')).toBeLessThan(-10);
  });

  it('leaves a rare name alone', () => {
    expect(commonNamePenalty('Ebrahim Sorkhabi')).toBe(0);
  });

  it('does not penalise a common first name with a rare surname', () => {
    expect(commonNamePenalty('John Sorkhabi')).toBe(0);
  });

  it('never exceeds the documented maximum', () => {
    expect(commonNamePenalty('James Smith')).toBeGreaterThanOrEqual(-MAX_COMMON_NAME_PENALTY);
  });

  it('is applied automatically to name-based findings', () => {
    const common = assessConfidence({
      signals: ['name_plus_locality'],
      nameOnly: false,
      nameSearched: 'John Smith',
    });
    const rare = assessConfidence({
      signals: ['name_plus_locality'],
      nameOnly: false,
      nameSearched: 'Ebrahim Sorkhabi',
    });

    expect(common.score).toBeLessThan(rare.score);
    expect(common.signals.some((signal) => signal.id === 'common_name_penalty')).toBe(true);
  });
});
