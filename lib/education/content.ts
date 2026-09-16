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
      'A data breach is when a company that held information about you loses control of it — usually because someone broke into their systems, but sometimes because it was left exposed by mistake.',
      'Once that happens the data tends to circulate indefinitely. It gets copied, traded and compiled into larger collections. There is no realistic way to pull it back, which is why the useful response is to change what the stolen data can still unlock rather than to try to delete it.',
      'Being in a breach is not a sign you did anything wrong. It means a company you trusted was compromised.',
    ],
  },

  password_in_breach: {
    question: 'My password was in a breach. What does that actually mean?',
    answer: [
      'It means the breached company was storing credentials, and those were taken along with everything else. Depending on how well they were protected, attackers may be able to recover the original password.',
      'The real danger is reuse. Attackers take the credentials from one breach and try them automatically against hundreds of other services — email, banking, shopping. This is called credential stuffing, and it is why one old breach at a forum you forgot about can cost you your email account.',
      'Change the password on the breached service, and change it anywhere else you used the same one or a close variant. Turning on two-factor authentication matters more than the password itself: it means a stolen password alone is not enough.',
    ],
  },

  password_reuse: {
    question: 'Why is reusing a password so dangerous?',
    answer: [
      'A reused password turns one company’s security failure into your security failure everywhere. The attacker does not need to break into your bank; they just need the forum that leaked in 2016 to have had the same password.',
      'A password manager solves this properly, because it removes the reason people reuse passwords in the first place — nobody can remember eighty different ones.',
    ],
  },

  stealer_log: {
    question: 'What is malware-stolen data?',
    answer: [
      'This is different from a company being breached. It means a device — a computer or phone, yours or one you logged in on — was infected with software that harvested saved logins, browser cookies and session tokens directly.',
      'That matters more than a normal breach, because the theft was not limited to one service. Anything signed in on that device at the time could be affected, and stolen session tokens can sometimes bypass two-factor authentication entirely.',
      'The right response is to treat the device as compromised: run a malware scan, then change passwords and sign out all sessions from a device you trust, not the infected one.',
    ],
  },

  data_broker: {
    question: 'What is a data broker?',
    answer: [
      'A data broker is a company whose business is collecting information about people — from public records, purchase histories, apps and other brokers — and selling it. You never signed up with them and most people have never heard of them.',
      'They are the reason your home address, age, phone number and relatives can appear on a search site you have no relationship with. In most cases this is legal, and in most cases you have a right to make them stop.',
      'Opting out works, but it is per-company and they re-add people over time, so it needs repeating. Some jurisdictions now offer a single request that covers every registered broker at once.',
    ],
  },

  drop: {
    question: 'What is DROP?',
    answer: [
      'DROP is California’s Delete Request and Opt-Out Platform, run by the state privacy regulator rather than by a company. It went live on 1 January 2026.',
      'You submit one verified request, and every data broker registered in California — around six hundred of them — is legally required to delete what they hold about you and to keep doing so on an ongoing basis.',
      'It is the single highest-value privacy action available to a California resident, because it replaces hundreds of individual opt-out forms with one.',
    ],
  },

  public_profile: {
    question: 'Why does a public profile matter?',
    answer: [
      'Individually, a public profile is usually harmless — you probably meant it to be public. The risk is aggregation: a username on a gaming site, the same username on a professional network, and a photo on a third all combine into a picture of you that none of them revealed alone.',
      'That combined picture is what makes convincing phishing and social-engineering possible, and what lets somebody link a pseudonymous account back to your real identity.',
      'Old accounts are the ones worth attention. They often hold information you would not post today, under passwords you no longer use.',
    ],
  },

  username_reuse: {
    question: 'Why does reusing a username matter?',
    answer: [
      'A distinctive username is close to an identifier. Reusing one across services lets anyone connect those accounts to each other in seconds, including accounts you assumed were separate from your real name.',
      'This is also why a username match is weaker evidence than it looks. Common usernames are held by many different people, so finding one does not mean the account is yours — which is why results here are marked as possible rather than confirmed unless something else corroborates them.',
    ],
  },

  search_result: {
    question: 'Why is my name in search results?',
    answer: [
      'Search engines index pages that are publicly reachable. A name can appear through club listings, event programmes, company filings, news, forum posts or documents somebody else published.',
      'Much of this is entirely benign. It is worth reviewing anyway, because search results are usually the first thing someone researching you will see, and because pages can outlive their purpose by years.',
      'Removing an indexed page means dealing with the site that hosts it — de-indexing alone leaves the page live.',
    ],
  },

  archived_page: {
    question: 'What is an archived page?',
    answer: [
      'Web archives keep historical copies of public pages. A profile you deleted years ago may still be readable in an archive, exactly as it was.',
      'This is genuinely useful for the web as a public record, and genuinely awkward when the record is your teenage forum posts. Archives generally have their own removal processes, separate from the original site.',
    ],
  },

  confidence: {
    question: 'How sure are you that this is me?',
    answer: [
      'Every result carries a confidence level and lists the reasons behind it. "Verified" means it matched the email address you proved you own, or that you confirmed it yourself. "Likely" means several independent things line up. "Possible" means the match is loose — most often a name alone.',
      'Names are weak evidence and common names are weaker still, so a name-only result is never presented as confirmed no matter how many other hints there are. If a result is not you, say so and it will be set aside.',
    ],
  },

  coverage: {
    question: 'Why does it say the scan was partial?',
    answer: [
      'No service can search the whole internet, and this one does not pretend to. It queries a specific set of sources, each with its own limits, and some of them may be unconfigured, rate-limited, temporarily down, or declined by you.',
      'When that happens the scan says so and names the source. A quiet result from a source that was never actually reached would be worse than useless — it would be a false reassurance.',
    ],
  },

  no_passwords: {
    question: 'Why won’t you show me the leaked password?',
    answer: [
      'This tool never retrieves, stores or displays credentials, even yours. It only records the fact that a breach included them.',
      'That is a deliberate limit. A service that returns real passwords is one database mistake away from becoming a tool for breaking into other people’s accounts, and knowing the exact string does not change what you need to do: change it wherever you used it, and turn on two-factor authentication.',
    ],
  },
};

export function explainerFor(key: string): Explainer | undefined {
  return EXPLAINERS[key];
}
