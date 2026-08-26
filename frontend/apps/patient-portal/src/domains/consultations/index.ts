/**
 * The consultations domain's PUBLIC SURFACE.
 *
 * Everything this domain offers the rest of the app is exported here, and nothing else is
 * importable: reaching into ./components or ./api from another domain is a build failure,
 * not a code-review note. Cross-domain composition belongs in the route layer.
 *
 * WHAT IS BEHIND THIS LINE AND MUST STAY THERE. The join-token flow — issue, redeem, the
 * single-use accounting and the HTTP-only cookie that remembers an entry — is exactly the
 * kind of thing that should have one way in. So is the decision about whether a booking may
 * be entered, which reads the appointment's status and times and is the reason this domain
 * knows about appointments at all. A screen that wanted "just the credentials" would be a
 * screen able to open a room without spending a token, and the whole point of two calls is
 * that nobody can.
 *
 * THE SURFACE IS FOUR THINGS, AND THE FIRST IS ALMOST ALL OF IT:
 *
 *   ConsultationScreen   the entire journey behind one link — lobby, room, and every
 *                        honest reason for neither. A route renders this and nothing else.
 *                        The room now carries a working chat panel rather than a notice
 *                        saying chat does not exist: `consultation_messages` is a real table
 *                        and `ConsultationMessageController` is a real route, so the
 *                        placeholder went the moment the endpoint arrived and not before.
 *                        Nothing new is exported for it — the transcript is loaded by
 *                        `loadConsultationEntry` with everything else, because reads are
 *                        audited and one screen should be one read.
 *   EmergencyGuidance    the clinic's standing emergency guidance, exported so that any
 *                        other patient-facing screen that needs it carries the SAME words
 *                        rather than a second, drifting copy. H3 requires it to be
 *                        persistent; a copy per screen is how it stops being.
 *   consultationHref     the one URL — the `{join_link}` in the confirmation SMS, the
 *                        resume link after a dropped call, and the address of the route
 *                        that must render ConsultationScreen.
 *   ConsultationMode     the booked/held mode, re-exported from the generated contract so
 *                        that a route composing scheduling with this domain does not
 *                        hand-write the union.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md
 * @see docs/30-architecture/realtime-and-video.md
 */
export { ConsultationScreen } from './components/ConsultationScreen'
export { EmergencyGuidance } from './components/EmergencyGuidance'
export { consultationHref } from './api/paths'
export type { ConsultationMode } from './api/consultations'
