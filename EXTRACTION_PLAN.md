# Extraction plan

Standalone product carved out of ContentFlow (`Daky0000/Saas` @ `1bbabe09`).
Name is a placeholder until decided.

## Decisions (2026-11-06)

| Topic | Decision |
|---|---|
| Separation | New repo, fully standalone (own DB, auth, deploy) |
| Users | New customers, separate signup; no shared data with ContentFlow |
| Billing | Free at launch. Billing/payment code removed |
| AI cost cap | None at launch. Credit code kept dormant so a quota can be re-enabled |
| AI agents | Backend agents kept behind features; no AI Team page |
| Social Inbox | Included |
| Sales voice (Vapi) | Included |
| Leads import / Google Sheets | Dropped |
| Stack | Same: React + Vite / Express / Postgres / Railway |

## In scope

Based on the ContentFlow nav toggles that are on.

- Workspace: Dashboard, Notifications, Social Inbox (+ client review portal)
- CRM: Companies (with activities and calendar meetings)
- Sales: Leads, Conversations, Follow-ups, Intelligence, Settings
- Marketing: Overview
- Content: Posts, Automation, Media, AI Studio, Workflow, Analytics
- Integrations (social accounts, WordPress, calendar; no leads import)
- Shell: auth, settings, profile, workspace/projects, tasks, admin console (trimmed)

## Out of scope (to remove)

Frontend pages: CRMPipeline, CRMLeadScoring, GmailAgent, MarketingContacts,
MarketingEmail, MarketingCampaigns, MarketingSurveys, MarketingAutomations,
MarketingForms, MarketingLeads, MarketingLeadsImport, ConnectorHub,
ConnectorProviderSetup, ConnectorSyncDashboard, AITeam, Billing, Credits,
PublicSurvey.

Backend modules: mailing, campaign + campaignEmailWorker, surveys, forms,
public forms, mailing automations (automationEngine/automationRoutes),
crmDeals, leadScoring, gmailInbox, leadgen, leads + google-sheets,
connectors (registry/preferences/sync), billing, paystack, hubtel, pricing
purchase flow, tracking + short links, dakyLearn, apify, higgsfield.

## Cross-feature couplings to cut

- `pages/Analytics.tsx` reads mailing analytics, contacts and surveys. Remove those widgets.
- `pages/Dashboard.tsx` reads `/api/mailing/analytics`. Remove that card.
- `pages/CRMCompanies.tsx` uses Gmail sync and `/api/mailing/contacts`. Drop Gmail sync; source contacts elsewhere.
- `components/crm/ScheduleMeetingModal.tsx` uses `/api/mailing/contacts`.
- Several backend modules take `fireAutomationTrigger`; remove that wiring.

## Steps

1. Baseline copy (done).
2. Prune frontend; `vite build` clean after each batch.
3. Prune backend; bundle + tests green after each batch. (`tsc` on the API has never worked: TS5110. Fix early.)
4. Fresh Postgres; keep existing migrations for v1, prune unused tables later.
5. New secrets and OAuth apps (Meta, LinkedIn, TikTok, Pinterest, Google), new Resend domain. Meta app review restarts: start early.
6. Rebrand (name, logo, colors, landing page).
7. New Railway project + domain.
8. New features.

## Risks

- No AI cost cap with open signup: abuse can run up provider bills. Require email verification before AI use at minimum.
