/**
 * Moved to lib/applications/status-fields.ts so the AI app's
 * submit_application shares the rules (lib/applications/
 * submit-direct-application.ts). Re-exported for existing imports.
 */
export {
    buildApplicationStatusFields,
    isWithdrawnApplication,
    type ApplicationStatusFields,
    type ExistingApplicationState,
} from '@/lib/applications/status-fields';
