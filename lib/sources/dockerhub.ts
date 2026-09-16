import { assessConfidence } from '../confidence/score';
import type { DataType } from '../normalize/finding';
import { corroborate } from './corroborate';
import { requestJson } from './http';
import { closeAccountAction, legalErasureAction } from '../normalize/removal';
import { sweepHandles } from './sweep-handles';
import type { Emit, Handle, ScanContext, Source, SourceOutcome } from './types';

/**
 * Docker Hub.
 *
 * People sign up to pull one image and never think about the profile again, but
 * it is fully public and the signup form asks for a real name, company and
 * location. That combination — real name plus employer plus city, attached to a
 * username used elsewhere — is exactly the aggregation risk worth surfacing.
 */

function apiBase(): string {
  return process.env.DOCKERHUB_API_BASE ?? 'https://hub.docker.com/v2';
}

interface DockerHubUser {
  username?: string;
  full_name?: string;
  location?: string;
  company?: string;
  profile_url?: string;
  date_joined?: string;
}

export const dockerHubSource: Source = {
  id: 'dockerhub',
  label: 'Docker Hub',
  kind: 'profile',
  description:
    'Checks for a Docker Hub account under your username. These profiles are public and often carry a real name, employer and location.',
  homepage: 'https://hub.docker.com',
  requires: ['username'],
  sendsRawEmail: false,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    if (context.handles.length === 0) {
      return { status: 'skipped', reason: 'No username to search for' };
    }

    const check = async (handle: Handle): Promise<number> => {
      const user = await requestJson<DockerHubUser>(
        `${apiBase()}/users/${encodeURIComponent(handle.value)}/`,
        { signal: context.signal, timeoutMs: 8000 },
      );

      // 404 is how Docker Hub says the username is free.
      if (!user?.username) return 0;

      const match = corroborate(context, { name: user.full_name, location: user.location });

      const dataTypes: DataType[] = ['username', 'social_profile'];
      if (user.full_name) dataTypes.push('name');
      if (user.location) dataTypes.push('geolocation');
      if (user.company) dataTypes.push('employer');

      const published = [
        user.full_name ? 'a name' : null,
        user.company ? 'an employer' : null,
        user.location ? 'a location' : null,
      ].filter((item): item is string => Boolean(item));

      const publishedList =
        published.length > 1
          ? `${published.slice(0, -1).join(', ')} and ${published[published.length - 1]}`
          : published[0];

      const joinedYear = user.date_joined ? Number(user.date_joined.slice(0, 4)) : undefined;

      emit.finding({
        id: `dockerhub:profile:${handle.value}`,
        section: 'profiles',
        title: handle.derived ? `Docker Hub — ${handle.value}` : 'Docker Hub account',
        provider: { id: 'dockerhub', label: 'Docker Hub', url: 'https://hub.docker.com' },
        origin: { name: 'Docker Hub', domain: 'hub.docker.com' },
        occurredAt:
          user.date_joined && Number.isFinite(joinedYear)
            ? { date: user.date_joined.slice(0, 10), year: joinedYear, precision: 'day' }
            : undefined,
        dataTypes,
        confidence: assessConfidence({
          signals: ['username_exact', ...match.signals],
          nameOnly: false,
          usernameOnly: match.usernameOnly,
          derivedHandle: handle.derived,
          handleSource: handle.source,
        }),
        evidence: {
          url: `https://hub.docker.com/u/${encodeURIComponent(handle.value)}`,
          label: 'View the profile',
        },
        whyItMatters:
          (published.length > 0
            ? `Publishes ${publishedList}. Together that connects a technical handle to a real person at a real employer.`
            : 'Public profile. Confirms the handle is in use and when it was created.') +
          (match.note ? ` ${match.note}` : ''),
        actions: [
          {
            type: 'review_privacy_settings',
            label: 'Clear the optional profile fields',
            detail: 'Name, company and location are all optional.',
            url: 'https://hub.docker.com/settings/general',
          },
          closeAccountAction('Docker Hub', 'hub.docker.com'),
          legalErasureAction('Docker', 'https://www.docker.com/legal/privacy/'),
        ],
        educationKey: 'public_profile',
      });

      return 1;
    };

    return sweepHandles(context, check);
  },
};
