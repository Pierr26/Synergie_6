import type { Html } from './lib/html';
import { renderBody } from './features/body-risks/body';
import { renderCheckin } from './features/check-in/checkin';
import { renderCrew } from './features/crew/crew';
import { renderFollowUp } from './features/follow-up/followup';
import { renderHelp } from './features/help';
import { renderMeasurements } from './features/measurements/measurements';
import { renderNotifications } from './features/notifications/notifications';
import { renderOverview } from './features/overview/overview';
import { renderReports } from './features/reports/reports';
import { renderSettings } from './features/settings/settings';
import { renderTrends } from './features/trends/trends';

/** All views share one cached document; the router picks the renderer from the first path segment. */
export const routes: Record<string, () => Promise<Html>> = {
    overview: renderOverview,
    'check-in': renderCheckin,
    measurements: renderMeasurements,
    trends: renderTrends,
    body: renderBody,
    'follow-up': renderFollowUp,
    crew: renderCrew,
    notifications: renderNotifications,
    reports: renderReports,
    help: renderHelp,
    settings: renderSettings,
};
