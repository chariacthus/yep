/**
 * Inline explanations, keyed by finding type.
 *
 * These appear where the scan made them relevant and nowhere else. Somebody who
 * has never heard the phrase "data breach" should be able to read the finding
 * and understand what happened to them; somebody who already knows should be
 * able to ignore a collapsed summary line. That is the whole design: no quiz,
 * no course, no separate learning section.
 */

export interface Explainer {
  /** The question a confused person would actually ask. */
  question: string;
  /** Two or three short paragraphs. No jargon without immediately defining it. */
  answer: string[];
}

export const EXPLAINERS: Record<string, Explainer> = {
  breach: {
    question: 'What is a data breach?',
    answer: [
      'A company that held your data lost control of it. Once that happens the data circulates indefinitely and cannot be pulled back.',
      'So the useful response is changing what it can still unlock, not trying to delete it. Being in a breach is not something you did wrong.',
    ],
  },

  password_in_breach: {
    question: 'My password was in a breach. What does that actually mean?',
    answer: [
      'The danger is reuse. Attackers take credentials from one breach and try them automatically against hundreds of other services — email, banking, shopping.',
      'That is why a forum you forgot about can cost you your email account. Change it everywhere you reused it, and turn on two-factor authentication.',
    ],
  },

  password_reuse: {
    question: 'Why is reusing a password so dangerous?',
    answer: [
      'A reused password turns one company’s failure into your failure everywhere. Nobody needs to break into your bank if a forum leaked the same password.',
      'A password manager fixes this properly — it removes the reason people reuse in the first place.',
    ],
  },

  stealer_log: {
    question: 'What is malware-stolen data?',
    answer: [
      'Not a company breach — a device was infected with software that harvested saved logins and session cookies directly. Anything signed in at the time is affected.',
      'Stolen session tokens can bypass two-factor entirely. Scan the device, then change passwords from a different one.',
    ],
  },

  data_broker: {
    question: 'What is a data broker?',
    answer: [
      'A company that collects information about people and sells it. You never signed up, and most people have never heard of them.',
      'They are why your address, age and relatives appear on search sites you have no relationship with. Opting out works, but it is per-company and needs repeating.',
    ],
  },

  drop: {
    question: 'What is DROP?',
    answer: [
      'California’s official deletion platform, live since January 2026. One verified request legally forces every registered broker — around six hundred — to delete what they hold.',
      'It replaces hundreds of individual opt-out forms with one.',
    ],
  },

  public_profile: {
    question: 'Why does a public profile matter?',
    answer: [
      'One profile is usually harmless. The risk is aggregation — a handle on a gaming site, the same handle on a professional network, a photo on a third.',
      'Combined, they make convincing phishing possible and link pseudonymous accounts to your real name. Old accounts matter most.',
    ],
  },

  username_reuse: {
    question: 'Why does reusing a username matter?',
    answer: [
      'A distinctive handle is close to an identifier — reusing it connects your accounts to each other in seconds.',
      'It is also weak evidence: common handles belong to many people, which is why these results stay "possible" unless something corroborates them.',
    ],
  },

  search_result: {
    question: 'Why is my name in search results?',
    answer: [
      'Club listings, event programmes, filings, forum posts, documents somebody else published. Much of it is benign.',
      'Worth reviewing anyway — it is the first thing anyone researching you sees. Removing a page means dealing with the site; de-indexing just hides it.',
    ],
  },

  archived_page: {
    question: 'What is an archived page?',
    answer: [
      'A profile you deleted years ago may still be readable in an archive, exactly as it was.',
      'Archives have their own removal process, separate from the original site.',
    ],
  },

  confidence: {
    question: 'How sure are you that this is me?',
    answer: [
      'Confirmed means it matched something you entered exactly. Likely means several things line up. Possible means the match is loose — usually a name or a guessed handle.',
      'A name-only result is never presented as confirmed, however much else lines up. If one is not you, say so and it is set aside.',
    ],
  },

  coverage: {
    question: 'Why does it say the scan was partial?',
    answer: [
      'No service searches the whole internet. This one queries a specific set of sources, and some may be rate-limited, down, or switched off by you.',
      'When that happens it names them. A quiet result from a source never reached would be a false all-clear.',
    ],
  },

  no_passwords: {
    question: 'Why won’t you show me the leaked password?',
    answer: [
      'This tool never retrieves or displays credentials, even yours. It only records that a breach included them.',
      'A service that returns real passwords is one mistake away from being a break-in tool — and knowing the string changes nothing about what you should do.',
    ],
  },
};

export function explainerFor(key: string): Explainer | undefined {
  return EXPLAINERS[key];
}
