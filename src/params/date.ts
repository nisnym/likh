import { isDayKey } from '$lib/core/date/day';
import type { ParamMatcher } from '@sveltejs/kit';

/**
 * Only real day keys claim the root route, so `/settings` and friends fall
 * through to their own pages instead of being read as a date.
 */
export const match: ParamMatcher = (param) => isDayKey(param);
