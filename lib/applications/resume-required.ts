/**
 * The refusal for an application sent with no resume, where a channel asks
 * for one (the AI app connector, lib/applications/submit-direct-application.ts
 * requireResume). Its own module so a client form can import the text too.
 */
export const RESUME_REQUIRED_ERROR = 'A resume is required to apply. Upload one to your profile and try again.';
