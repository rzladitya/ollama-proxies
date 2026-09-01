# Ollama Proxy — Design System Specification V1

**Document:** UI Design System & Product Interface Specification  
**Product:** Ollama Proxy  
**Version:** 1.0  
**Status:** Draft for implementation  
**Primary audience:** Product designer, frontend engineer, design reviewer, QA

---

## 1. Purpose

This design system defines the visual, interaction, layout, and component rules for Ollama Proxy.

The product is a developer-focused infrastructure dashboard. Its interface must make routing state, account health, request behavior, model availability, failover events, and credentials understandable without adding visual complexity.

The system should feel:

- technical
- calm
- compact
- operational
- trustworthy
- modern
- information-dense without feeling crowded

The interface should not look like a generic “AI app.” Avoid decorative AI motifs, oversized gradients, glowing networks, chatbot illustrations, or futuristic visual noise.

Visual direction may take inspiration from modern developer tools such as Vercel, Linear, Cloudflare, Supabase, or OpenRouter, but must not copy their branding or exact component styling.

---

# 2. Design Principles

## 2.1 Operational Clarity First

The most important interface question is:

> What is happening in the gateway right now, and why?

Status, routing, health, latency, and failover information must be prioritized over decorative visuals.

## 2.2 Dense but Scannable

Tables, compact cards, status indicators, and short labels are preferred over large presentation-style modules.

## 2.3 State Must Never Depend on Color Alone

Every state requires:
- semantic color
- text label or icon
- accessible contrast

Example:

```text
● Active
! Cooldown
▲ Degraded
× Disabled
```

## 2.4 Technical Values Use Monospace Selectively

Use monospace for:
- API keys
- model IDs
- request IDs
- endpoints
- header names
- account IDs
- error codes
- code/config snippets

Do not use monospace for all UI text.

## 2.5 Destructive Actions Require Friction

Actions such as:
- delete account
- revoke API key
- disable routing
- reset configuration

must use confirmation.

## 2.6 Sensitive Data Is Masked by Default

Credentials must not be casually revealed.

---

# 3. Product Shell

## 3.1 Desktop Layout

Recommended structure:

```text
┌────────────────────────────────────────────────────┐
│ Sidebar │ Main Header                              │
│         ├──────────────────────────────────────────│
│         │ Main Content                             │
│         │                                          │
│         │                                          │
└────────────────────────────────────────────────────┘
```

Sidebar:
- fixed on desktop
- compact width
- collapsible optional

Main content:
- centered within a max-width suitable for large dashboards
- pages with tables may use wider/full content width

Recommended max widths:

```text
Default page: 1440px
Data-heavy table page: 1600px or fluid
Form page: 960px
Modal content: 480–720px
```

---

# 4. Navigation

Primary navigation:

```text
Overview
Accounts
Models
API Keys
Requests
Routing
Settings
```

Secondary/bottom navigation:

```text
Documentation
System Status
Profile / Admin
```

## 4.1 Sidebar Item

States:

- default
- hover
- active
- disabled
- notification indicator optional

Active state should use:
- subtle filled background
- stronger text
- optional left indicator

Avoid bright full-width accent fills.

---

# 5. Foundation Tokens

Token names are conceptual. Exact CSS variable names can follow the implementation stack.

---

## 5.1 Color System

### Neutral Palette

Use neutral/slate/zinc family.

Required semantic tiers:

```text
bg-canvas
bg-surface
bg-subtle
bg-elevated

border-default
border-strong

text-primary
text-secondary
text-muted
text-disabled
```

Recommended light-mode character:

- canvas: near-white
- surfaces: white
- subtle sections: very light neutral gray
- borders: cool/neutral gray
- text primary: near-black, not pure black

### Accent

Use one restrained primary accent.

Recommended direction:
- green-teal
or
- neutral with subtle green accent

Accent is used for:
- primary button
- active focus indication
- selected controls
- healthy status highlights where appropriate

Do not make all interface elements green.

---

## 5.2 Semantic Status Colors

### Healthy / Active

Semantic token:

```text
status-success
status-success-bg
status-success-border
```

Use for:
- Active
- Healthy
- Successful request
- Connected

### Cooldown / Warning

```text
status-warning
status-warning-bg
status-warning-border
```

Use for:
- Cooldown
- Partial model availability
- approaching thresholds

### Degraded

```text
status-degraded
status-degraded-bg
status-degraded-border
```

Use orange/amber family distinct from cooldown where practical.

### Error / Disabled

```text
status-danger
status-danger-bg
status-danger-border
```

Use for:
- Invalid credential
- Disabled
- Failed request
- destructive action

### Neutral

```text
status-neutral
status-neutral-bg
```

Use for:
- unknown
- not configured
- inactive
- not applicable

---

# 6. Typography

Use a clean sans-serif UI typeface supported by the application environment.

Recommended examples:
- Inter
- Geist
- system sans stack

Do not depend on custom font files for core usability.

Monospace:
- Geist Mono
- JetBrains Mono
- system monospace fallback

## 6.1 Type Scale

### Page Title

```text
28–32px
600–700 weight
tight line height
```

### Section Title

```text
18–20px
600
```

### Card Metric

```text
24–30px
600–700
```

### Body

```text
14px default
15–16px for explanatory content
```

### Table

```text
13–14px
```

### Caption

```text
12px
```

### Code / IDs

```text
12–13px monospace
```

---

# 7. Spacing

Use a 4px base scale.

Recommended token values:

```text
space-1 = 4
space-2 = 8
space-3 = 12
space-4 = 16
space-5 = 20
space-6 = 24
space-8 = 32
space-10 = 40
space-12 = 48
```

Common rules:

- card inner padding: 16–20px
- page section gap: 24–32px
- form field vertical gap: 16px
- table row height: 40–48px
- compact toolbar control gap: 8px

Avoid excessive whitespace typical of marketing sites.

---

# 8. Radius

Recommended:

```text
radius-sm = 6px
radius-md = 8px
radius-lg = 10–12px
radius-pill = 999px
```

Use:
- controls: 6–8px
- cards: 8–12px
- badges: pill or 6px

Avoid excessively rounded “bubble UI.”

---

# 9. Shadows and Elevation

Use minimal shadows.

Default cards should rely on:
- background
- border
- spacing

Use shadow primarily for:
- dropdown
- modal
- popover
- floating drawer

Do not add heavy shadows to every dashboard card.

---

# 10. Borders

Standard:
- 1px
- low-contrast neutral

Stronger border for:
- focused element
- selected card
- important warning
- error state

---

# 11. Iconography

Use a consistent outline icon library.

Recommended:
- Lucide
- equivalent open icon system

Rules:
- 16px typical control icon
- 18–20px navigation icon
- icon + text for ambiguous actions
- icon-only actions require tooltip

Avoid custom illustrative icons unless necessary.

---

# 12. Core Components

---

## 12.1 Button

Variants:

### Primary
Use for one primary action per local context.

Examples:
- Add Account
- Create API Key
- Save Changes

### Secondary
Use for:
- Test Connection
- Refresh Models
- Edit

### Ghost
Use for:
- table row actions
- toolbar actions
- low-emphasis actions

### Destructive
Use for:
- Delete Account
- Revoke Key

Sizes:

```text
sm
md
```

Large buttons are unnecessary for this product.

Required states:
- default
- hover
- active
- focus
- disabled
- loading

Loading button:
- preserve width
- show spinner
- disable repeat submission

---

## 12.2 Input

Types:
- text
- password
- number
- search
- URL

Required states:
- empty
- filled
- focus
- error
- disabled
- read-only

Fields require:
- label
- optional helper text
- inline error message

Example:

```text
Account Name
[ ollama-main-05                     ]

Used only inside the proxy.
```

---

## 12.3 Secret Input

Used for Ollama API keys.

Behavior:
- masked by default
- optional reveal during creation/editing
- copy disabled after secret is no longer retrievable
- warn before replacing existing secret

---

## 12.4 Select / Combobox

Use for:
- account pool
- status
- model
- environment
- routing strategy

Multi-select:
- allowed models
- failover statuses
- pool members

Large model lists should support search.

---

## 12.5 Toggle

Use only for true binary settings.

Examples:
- Enable account
- Sticky routing
- Automatic failover
- Metadata logging

Avoid toggles for actions that require immediate destructive confirmation.

---

## 12.6 Checkbox

Use for:
- multi-selection
- failover error categories
- account/model mapping
- bulk operations

---

## 12.7 Badge

Variants:

```text
success
warning
degraded
danger
neutral
info
```

Examples:

```text
Active
Cooldown
Degraded
Disabled
Healthy
Partial
Streaming
Failover
```

Badges should be compact.

---

## 12.8 Status Dot

Use beside short status text.

Example:

```text
● Active
```

Never display a dot without text when status meaning is critical.

---

## 12.9 Card

Card variants:

### Standard Card
General information.

### Metric Card
One KPI plus context.

### Status Card
Service/account health.

### Configuration Card
Settings sections.

### Warning Card
Important behavioral limitation.

Cards should not all have identical visual weight.

---

## 12.10 Metric Card

Structure:

```text
Label
Primary value
Secondary context
Optional mini trend
```

Example:

```text
Success Rate
99.2%
+0.3% vs previous 24h
```

Do not use large decorative icons in every metric card.

---

# 13. Tables

Tables are central to the product.

Required table features:

- sticky or clear header
- sortable columns where useful
- row hover
- compact density
- loading state
- empty state
- pagination where needed
- column alignment
- action menu
- optional row selection

## 13.1 Alignment

Text:
- left

Numbers:
- right where comparison benefits

Status:
- left

Timestamps:
- left or right, but consistent

## 13.2 IDs

Request IDs and account IDs:
- monospace
- truncate visually
- copy action
- full value in tooltip/detail

## 13.3 Row Density

Recommended row height:

```text
44px default
40px compact
```

---

# 14. Table Toolbar

Typical toolbar:

```text
Search
Status filter
Model filter
Account filter
Time range
Secondary action
Primary action
```

Do not overload one line with too many filters.

On narrower layouts, filters may wrap or move into a filter panel.

---

# 15. Dropdown / Action Menu

Use for secondary row actions.

Example account menu:

```text
View Details
Test Connection
Edit
Disable
Delete
```

Destructive items separated visually from normal actions.

---

# 16. Modal

Use for:
- add account
- confirmation
- quick API key creation
- simple configuration

Avoid using modal for complex multi-section editing.

Modal structure:

```text
Title
Description
Body
Footer actions
```

Primary action on right.

Destructive confirmation should explicitly name the resource.

---

# 17. Drawer

Use for:
- request details
- quick account inspection
- contextual debugging

Recommended width:

```text
520–680px
```

Request detail drawer should preserve the table behind it.

---

# 18. Tabs

Use for detail pages where information can be grouped.

Potential account detail tabs:

```text
Overview
Models
Requests
Health
```

Do not use tabs if all content comfortably fits in one readable page.

---

# 19. Tooltip

Required for:
- icon-only buttons
- truncated IDs
- technical acronyms
- ambiguous metrics

Tooltip content should be short.

Long explanations should use an info panel.

---

# 20. Toast / Notification

Use for transient feedback:

```text
Account added
Connection successful
API key copied
Account disabled
Settings saved
```

Errors that require corrective action should remain visible inline, not only as toast.

---

# 21. Empty States

Empty states must explain what is missing and provide the next action.

Example Accounts:

```text
No Ollama accounts configured

Add at least one authorized Ollama Cloud credential before sending requests.

[ Add Account ]
```

Avoid decorative illustration unless minimal.

---

# 22. Loading States

Use:
- skeleton for dashboard cards/tables
- spinner for local button action
- progress indicator for connection test or model refresh

Do not blank the full application for local refresh operations.

---

# 23. Error States

Three levels:

### Inline Validation
Example:
Invalid account name.

### Component Failure
Example:
Could not load request logs. Retry.

### System Failure
Example:
Redis unavailable.

System-level failures should surface in:
- System Status
- global notification where operationally important

---

# 24. Specialized Product Components

---

## 24.1 Account Status Badge

Supported states:

```text
Active
Degraded
Cooldown
Invalid
Disabled
```

Display:
- semantic badge
- optional tooltip with reason

Example:

```text
Cooldown
429 received 2m ago
Retry in 3m
```

---

## 24.2 Account Health Card

Structure:

```text
Account Name
Status

Requests Today
Active Requests
Success Rate
Avg Latency

Last Success
Last Error
```

Use on account detail or overview.

---

## 24.3 Model Availability Indicator

Examples:

```text
8 / 8 accounts
7 / 8 accounts
3 / 8 accounts
```

Status interpretation:
- full = healthy
- partial = warning
- zero = unavailable

A detail view should expose account matrix.

---

## 24.4 Account Availability Matrix

Example:

| Account | Available | Status | Priority | Latency |
|---|---|---|---:|---:|
| ollama-01 | ✓ | Active | 100 | 3.2s |
| ollama-02 | ✓ | Active | 100 | 3.8s |
| ollama-03 | — | Cooldown | 100 | — |

Use check/neutral symbols plus text, not color only.

---

## 24.5 Routing Distribution Bar

Horizontal proportional bar/chart.

Use for account traffic share.

Must support:
- account name
- request percentage
- request count
- optional status

Avoid pie charts when many accounts exist.

---

## 24.6 Failover Event Row

Structure:

```text
time
model
from account -> to account
reason
duration/attempt
```

Example:

```text
10:31:22
qwen3.5:cloud
ollama-03 -> ollama-01
429 Rate Limited
```

---

## 24.7 Routing Timeline

Used in request detail.

Example:

```text
Request received
|
Proxy key authenticated
|
Lease hit -> ollama-03
|
429 Rate Limited
|
Cooldown applied
|
Fallback -> ollama-01
|
Success
|
Lease updated
```

Design:
- vertical timeline
- small semantic icons
- timestamp per event
- expandable metadata optional

---

## 24.8 API Key Display

Created state:

```text
sk-proxy-x8HJ.................
[ Copy ]
```

After leaving creation page:

```text
sk-proxy-••••••••7W2K
```

Never allow full secret recovery from a normal detail page.

---

## 24.9 Endpoint Code Field

Example:

```text
https://proxy.example.com/v1
```

Style:
- monospace
- subtle code background
- copy button
- no editable appearance unless actually editable

---

## 24.10 Cooldown Countdown

Optional component:

```text
Cooldown
Retry eligible in 03:14
```

Do not rely on second-by-second updates if unnecessary.

---

# 25. Charts

Use charts sparingly.

Primary charts:

1. Request traffic
2. Error/failover trend
3. Account request distribution
4. Latency trend
5. Account health history

## 25.1 Request Traffic Chart

Time series.

Series:
- requests
- errors
- failovers

Default period:
24h

Controls:
- 1H
- 6H
- 24H
- 7D

## 25.2 Latency

Use:
- line chart
or
- compact sparkline

Avoid 3D charts, gauges, and decorative gradients.

## 25.3 Chart Color

Semantic:
- primary traffic = neutral/accent
- errors = danger
- failovers = warning
- healthy = success where appropriate

Keep grid lines subtle.

---

# 26. Overview Page Specification

## Header

```text
Overview

Monitor Ollama Cloud gateway traffic and account availability.
```

Right side:

```text
Production selector
Add Account
```

## KPI Row

Recommended:

```text
Active Accounts
Requests Today
Success Rate
Avg Latency
Active Sessions
Failovers
```

Six cards may wrap into two rows based on width.

## Traffic Section

Large request traffic chart.

## Account Pool Section

Table with:
- Account
- Status
- Models
- Active Requests
- Requests Today
- Avg Latency
- Failovers

## Lower Section

Two-column desktop:
- Routing Distribution
- Recent Failovers

---

# 27. Accounts Page Specification

Header:

```text
Ollama Accounts
Manage Ollama Cloud credentials and routing availability.
```

Actions:
- Add Account

Toolbar:
- search
- status
- model
- pool optional

Table:
- Account
- Status
- Models
- Active
- Requests
- Error Rate
- Last Used
- Actions

Account name is clickable.

---

# 28. Account Detail Page

Header:

```text
ollama-main-02
Active
```

Actions:
- Test Connection
- Edit
- Disable

Metric cards:
- Requests Today
- Success Rate
- Active Requests
- Avg Latency
- 429 Errors
- Failovers

Sections:
1. Account Information
2. Available Models
3. Health History
4. Recent Requests

Sensitive credential:
- masked
- replacement only through explicit edit

---

# 29. Models Page

Table/card hybrid acceptable.

Columns:

```text
Model
Available Accounts
Health
Requests Today
Avg Latency
Routing
```

Click model for detail.

Model detail:

```text
Model Summary
Availability Matrix
Account Exclusions
Recent Requests
```

---

# 30. API Keys Page

Header:

```text
API Keys
Create proxy credentials for applications using this gateway.
```

Table:

```text
Name
Key
Allowed Models
Account Pool
Requests
Last Used
Status
Actions
```

Create flow should display:
- generated secret
- base URL
- integration snippet

Secret visibility only at creation.

---

# 31. Requests Page

This is one of the densest pages.

Toolbar:

```text
Time Range
Status
Model
Account
API Key
Failover Only
Search Request ID
```

Columns:

```text
Time
Request ID
Client
Model
Account
Status
Latency
Failover
Tokens
```

Recommended:
- status badge
- failover icon/text only when present
- request row opens detail drawer

Do not display prompt content in the table.

---

# 32. Request Detail Drawer

Sections:

## Summary

```text
Request ID
Client
Model
Session Hash
Initial Account
Final Account
Status
Latency
Streaming
```

## Routing Timeline

Vertical event sequence.

## Retry Information

```text
Attempt Count
Failover Count
Failure Reasons
```

## Optional Token Metadata

Only when upstream provides it.

Do not show:
- raw API keys
- raw prompt by default
- raw session identifier

---

# 33. Routing Page

This page should explain behavior visually without becoming a network architecture diagram.

Header:

```text
Routing
Configure how requests are distributed across Ollama Cloud accounts.
```

Primary strategy card:

```text
Sticky Session + Smart Failover
```

Visual flow:

```text
Existing Session
-> Lease
-> Existing Account

New Session
-> Eligible Accounts
-> Least Load
-> Weighted Selection
-> Create Lease

Failure
-> Cooldown
-> Fallback Account
-> Update Lease
```

Configuration groups:

1. Session Affinity
2. Account Selection
3. Failover
4. Cooldown
5. Streaming Behavior

Streaming warning card must be visually clear but not alarming:

```text
Failover is allowed only before response streaming begins.
Once output has been sent to the client, the current request is not replayed on another account.
```

---

# 34. Settings Page

Sections:

```text
Gateway
Storage
Logging
Security
```

Each section uses a configuration card.

Use clear save behavior:
- either one global Save button
- or explicit per-section Save

Do not mix both patterns.

Recommended:
- page-level Save Changes
- sticky footer only if page becomes long

---

# 35. System Status Page

Simple health view.

Service rows:

```text
Gateway
Database
Redis
Ollama Cloud Connectivity
```

Each shows:
- status
- short explanation
- last checked

Account aggregate:

```text
8 Active
1 Cooldown
1 Invalid
```

---

# 36. Form Patterns

## Add Account

Fields:

```text
Account Name
Ollama API Key
Routing Priority
Routing Weight
Enable immediately
```

Actions:

```text
Test Connection
Add Account
```

Connection test result should appear inline.

Success:

```text
Connection successful
6 models detected
```

Failure:

```text
Connection failed
401 Unauthorized
Check the API key and try again.
```

Do not expose raw upstream body if it could contain sensitive information.

---

# 37. Confirmation Patterns

## Disable Account

Confirmation text should explain impact:

```text
Disable ollama-main-02?

New requests will no longer be routed to this account. Existing requests are not terminated.
```

## Delete Account

Stronger confirmation:

```text
Delete ollama-main-02?

This removes the credential and account configuration from Ollama Proxy. This action cannot be undone.
```

## Revoke API Key

```text
Revoke Dify Production?

Applications using this proxy key will immediately lose access.
```

---

# 38. Copy Patterns

Copy buttons for:
- API base URL
- generated key
- request ID
- account ID
- model ID
- header names

Feedback:

```text
Copied
```

Use toast or temporary button label.

---

# 39. Content and Microcopy Style

UI language should be:

- precise
- compact
- technical
- non-marketing

Preferred:

```text
No eligible account is available.
```

Avoid:

```text
Oops! Something went wrong with your amazing AI connection.
```

Preferred button labels:

```text
Add Account
Test Connection
Create API Key
Refresh Models
Save Changes
Disable
Delete
Retry
```

Avoid vague labels:
- Continue
- Proceed
- Do It

unless context makes them unambiguous.

---

# 40. Date and Time

Default display for recent operational events:

```text
2 min ago
18 min ago
```

Tooltip/full detail:

```text
2026-09-01 10:31:22 +07:00
```

Request table may use precise time:

```text
10:31:22
```

Use one timezone consistently and expose configured timezone where relevant.

---

# 41. Number Formatting

Requests:

```text
18,429
```

Latency:

```text
3.8s
412ms
```

Percent:

```text
99.2%
```

Tokens:

```text
2.8k
```

Full exact values may appear in details/tooltips.

---

# 42. Responsive Behavior

Primary target:
- desktop developer/operator usage

Still support:
- tablet
- narrow browser windows

## Desktop

Full sidebar + tables.

## Tablet

Collapsed sidebar optional.

Tables:
- maintain important columns
- secondary columns may hide or move to row expansion

## Mobile

Mobile is secondary.

Prioritize:
- health status
- account actions
- request detail
- simple settings

Large operational tables may use horizontal scroll rather than destructive reflow.

---

# 43. Accessibility

Minimum goals:

- keyboard navigable
- visible focus state
- semantic HTML
- form labels bound to inputs
- icons with accessible names where needed
- color contrast meeting WCAG AA target
- status not communicated by color only
- tables have proper headers
- modal focus trap
- escape closes non-destructive overlays
- destructive actions not triggered accidentally

---

# 44. Focus States

Every interactive component requires clear keyboard focus.

Use:
- accent outline/ring
- sufficient contrast
- no removal of focus indicators

---

# 45. Dark Mode

V1 may be light-only if implementation scope is constrained.

If dark mode is implemented:
- use semantic tokens
- do not simply invert colors
- preserve status distinction
- keep charts legible
- ensure code blocks and tables remain readable

Design tokens should be structured so dark mode can be added later.

---

# 46. Skeleton Specification

Use skeletons for:
- KPI cards
- request table
- account table
- charts
- detail panels

Skeleton should approximate real content structure.

Avoid full-screen indeterminate loader for normal page navigation.

---

# 47. Data Refresh

Operational pages may auto-refresh.

If implemented:
- indicate last refresh
- avoid layout jumping
- do not steal scroll position
- pause aggressive refresh when tab is inactive

Example:

```text
Updated 8s ago
```

---

# 48. Live Status Behavior

Account state changes should update without forcing full-page navigation where practical.

Examples:
- Active -> Cooldown
- Cooldown -> Active
- request failover event arrives

Real-time transport is implementation-dependent.

The design must not require WebSocket specifically.

---

# 49. Sensitive Information Rules

Never render in normal pages:

- full upstream API key after save
- proxy key secret after creation step
- full user prompt unless a future explicit secure debugging mode is added
- response body by default

Masked examples:

```text
ollama_••••••••••••93K2
sk-proxy-••••••••7W2K
```

---

# 50. Component State Matrix

Every reusable component must include the following where applicable:

```text
Default
Hover
Focus
Active
Disabled
Loading
Error
Empty
Selected
Read-only
```

Do not deliver a component library containing only the ideal/default state.

---

# 51. Design Tokens — Suggested CSS Variable Shape

Example naming:

```css
--color-bg-canvas
--color-bg-surface
--color-bg-subtle
--color-text-primary
--color-text-secondary
--color-text-muted
--color-border-default

--color-accent
--color-success
--color-warning
--color-degraded
--color-danger

--radius-sm
--radius-md
--radius-lg

--space-1
--space-2
--space-3
--space-4
--space-6
--space-8
```

Exact hex values should be derived from the approved visual design rather than invented independently during implementation.

---

# 52. Component Naming Convention

Recommended implementation naming:

```text
AppShell
SidebarNav
PageHeader
MetricCard
StatusBadge
AccountStatusBadge
AccountHealthCard
ModelAvailabilityBadge
DataTable
TableToolbar
RequestStatus
RoutingTimeline
FailoverEvent
CodeValue
SecretValue
CopyButton
EmptyState
InlineAlert
HealthIndicator
ConfigSection
ConfirmDialog
DetailDrawer
```

---

# 53. Page-Level Component Mapping

## Overview

```text
AppShell
PageHeader
MetricCard x6
RequestTrafficChart
AccountPoolTable
RoutingDistribution
RecentFailovers
```

## Accounts

```text
PageHeader
TableToolbar
AccountTable
AccountStatusBadge
RowActionMenu
```

## Account Detail

```text
PageHeader
AccountStatusBadge
MetricCard
ConfigSection
ModelAvailabilityTable
HealthChart
RequestTable
```

## Models

```text
PageHeader
ModelTable
ModelAvailabilityBadge
```

## API Keys

```text
PageHeader
ApiKeyTable
SecretValue
CreateApiKeyDialog/Page
```

## Requests

```text
PageHeader
RequestFilterBar
RequestTable
RequestStatus
DetailDrawer
RoutingTimeline
```

## Routing

```text
PageHeader
RoutingStrategyCard
RoutingFlow
ConfigSection
InlineAlert
```

## Settings

```text
PageHeader
ConfigSection
Form controls
SaveBar
```

---

# 54. Design QA Checklist

Before a screen is considered final:

### Layout
- spacing follows token scale
- page header consistent
- table width reasonable
- no unnecessary card nesting

### Typography
- IDs use monospace
- headings follow hierarchy
- secondary copy is not too light

### Status
- state has text, not color only
- warning vs error distinction is clear
- cooldown includes reason/time where useful

### Interaction
- loading state exists
- error state exists
- empty state exists
- destructive action confirmation exists

### Security
- credentials masked
- prompt/body not accidentally exposed
- request IDs are safe to copy

### Accessibility
- keyboard focus visible
- labels present
- tooltips not required to understand core information
- contrast sufficient

---

# 55. V1 Screen Acceptance Criteria

## Overview
Operator can understand overall gateway health within 10 seconds.

## Accounts
Operator can identify:
- active
- cooldown
- degraded
- invalid
accounts without opening each account.

## Account Detail
Operator can determine why an account is unhealthy and when it last succeeded.

## Models
Operator can determine which accounts currently support each model.

## API Keys
Operator can identify which application owns a key and which pool/models it can use.

## Requests
Operator can trace one request to:
- client
- model
- selected account
- failover
- final result

## Routing
Operator can understand sticky routing and failover policy without reading source code.

## Settings
Operator can change configuration without ambiguity about save state.

---

# 56. Design System Non-Goals

The design system will not define:

- marketing website
- public landing page
- billing screens
- organization management
- prompt playground
- chat UI
- agent builder
- marketplace
- mobile-first native app
- complex analytics BI dashboard

---

# 57. Implementation Handoff Requirements

Frontend implementation should not begin from screenshots alone.

Handoff must include:

1. approved screen designs
2. token mapping
3. component inventory
4. component states
5. responsive rules
6. empty/loading/error behavior
7. API data requirements
8. exact status enum mapping
9. table column definitions
10. confirmation copy
11. secret masking rules

---

# 58. Final Visual Direction

The final product should communicate:

> “This is a focused infrastructure gateway that an engineer can trust and operate.”

It should not communicate:

> “This is a broad AI platform trying to do everything.”

Use clean neutral surfaces, disciplined spacing, compact tables, semantic status indicators, restrained accent color, clear technical typography, and minimal decoration.
