import { InstaQLEntity } from '@instantdb/react';
import { AppSchema } from '@/instant.schema';

export type Person = InstaQLEntity<AppSchema, 'people'>;
export type PersonRow = InstaQLEntity<
  AppSchema,
  'people',
  { claimedBy: {}; sources: {} }
>;
export type PersonFull = InstaQLEntity<
  AppSchema,
  'people',
  { profile: {}; claimedBy: {}; sources: {} }
>;
export type Profile = InstaQLEntity<AppSchema, 'profiles'>;
export type Source = InstaQLEntity<AppSchema, 'sources'>;
export type Claim = InstaQLEntity<AppSchema, 'claims', { person: {} }>;

export type PersonStatus =
  | 'none'
  | 'queued'
  | 'generating'
  | 'generated'
  | 'failed';

export const STATUS_LABELS: Record<PersonStatus, string> = {
  none: 'No profile',
  queued: 'Queued',
  generating: 'Generating…',
  generated: 'Profiled',
  failed: 'Failed',
};
