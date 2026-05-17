const express = require('express');
const { prisma } = require('../db/client');

const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');
const { cloneTemplates, readTemplateCache, writeTemplateCache } = require('../middleware/templates');

const router = express.Router();

const TEMPLATES = [
  {
    id: 'resume',
    title: 'Resume',
    description: 'Professional resume layout for job applications.',
    icon: 'badge',
    content:
      '<h1 style="font-family:Montserrat; font-size:40px; color:#0f172a; margin-bottom:4px;">Aria Thompson</h1>' +
      '<p style="font-family:Raleway; font-size:15px; color:#0f766e;">Senior Product Engineer | San Francisco, CA | aria.thompson@example.com | +1 (415) 555-0199 | linkedin.com/in/ariathompson</p>' +
      '<h2 style="font-family:Montserrat; font-size:28px; color:#0f172a; margin-top:18px;">Professional Summary</h2>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus suscipit, neque vel placerat tristique, arcu nisl tincidunt tortor, ut posuere lorem nisi vitae lectus. Sed gravida lorem vitae orci accumsan, non sagittis est volutpat.</p>' +
      '<h2 style="font-family:Montserrat; font-size:28px; color:#0f172a; margin-top:18px;">Experience</h2>' +
      '<h3 style="font-family:Montserrat; font-size:22px; color:#155e75;">Lead Frontend Engineer - NovaCloud Systems</h3>' +
      '<p style="font-family:Raleway; font-size:14px; color:#475569;">Jan 2022 - Present</p>' +
      '<ul>' +
      '<li>Architected a multi-tenant collaboration suite used by 120k monthly users.</li>' +
      '<li>Reduced editor render time by 37% through virtualized layout and run diffing.</li>' +
      '<li>Mentored 6 engineers and established shared frontend quality standards.</li>' +
      '</ul>' +
      '<h3 style="font-family:Montserrat; font-size:22px; color:#155e75;">Software Engineer - AtlasWorks</h3>' +
      '<p style="font-family:Raleway; font-size:14px; color:#475569;">Jun 2018 - Dec 2021</p>' +
      '<ul>' +
      '<li>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</li>' +
      '<li>Implemented internal design system with accessible component library coverage.</li>' +
      '<li>Partnered with product and UX to launch billing and audit-console experiences.</li>' +
      '</ul>' +
      '<h2 style="font-family:Montserrat; font-size:28px; color:#0f172a; margin-top:18px;">Education</h2>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155;"><strong style="color:#0f172a;">B.S. Computer Science</strong> - University of Washington, Seattle (2018)</p>' +
      '<h2 style="font-family:Montserrat; font-size:28px; color:#0f172a; margin-top:18px;">Skills Matrix</h2>' +
      '<table style="width:100%; border-collapse:collapse; border:1px solid #0ea5e9; margin:8px 0; font-family:Raleway; font-size:14px; color:#0f172a;">' +
      '<thead><tr>' +
      '<th style="border:1px solid #0ea5e9; padding:8px 10px; text-align:left; color:#155e75;">Skill</th>' +
      '<th style="border:1px solid #0ea5e9; padding:8px 10px; text-align:left; color:#155e75;">Level</th>' +
      '<th style="border:1px solid #0ea5e9; padding:8px 10px; text-align:left; color:#155e75;">Years</th>' +
      '</tr></thead>' +
      '<tbody>' +
      '<tr>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">React + TypeScript</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px; color:#0c4a6e; font-weight:700;">Expert</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">5</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Node.js + Express</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px; color:#0c4a6e; font-weight:700;">Advanced</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">4</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">PostgreSQL</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px; color:#0c4a6e; font-weight:700;">Advanced</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">4</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Docker + CI/CD</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px; color:#334155; font-weight:700;">Intermediate</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">3</td>' +
      '</tr>' +
      '</tbody></table>' +
      '<h2 style="font-family:Montserrat; font-size:28px; color:#0f172a; margin-top:18px;">Selected Highlights</h2>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur non velit eu justo scelerisque semper. Integer consequat eros non ipsum pretium, sed viverra lacus fermentum. Pellentesque habitant morbi tristique senectus et netus.</p>' +
      '<h2 style="font-family:Montserrat; font-size:28px; color:#0f172a; margin-top:18px;">Projects</h2>' +
      '<h3 style="font-family:Montserrat; font-size:22px; color:#155e75;">DocFlow AI Assistant</h3>' +
      '<p style="font-family:Raleway; font-size:15px; color:#334155;">Designed and shipped context-aware writing suggestions for enterprise documentation workflows. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>' +
      '<h2 style="font-family:Montserrat; font-size:28px; color:#0f172a; margin-top:18px;">Certifications</h2>' +
      '<ul>' +
      '<li>AWS Certified Developer - Associate (2025)</li>' +
      '<li>Professional Scrum Master I (2024)</li>' +
      '<li>Google UX Design Certificate (2023)</li>' +
      '</ul>' +
      '<h2 style="font-family:Montserrat; font-size:28px; color:#0f172a; margin-top:18px;">Leadership & Community</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#334155; line-height:1.7;">Mentor at Women Who Code and volunteer facilitator for monthly frontend architecture workshops. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer ac sapien vitae justo faucibus scelerisque ut vitae lectus.</p>' +
      '<h2 style="font-family:Montserrat; font-size:28px; color:#0f172a; margin-top:18px;">Languages</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#334155;">English (Native), Spanish (Professional), Hindi (Conversational)</p>' +
      '<h2 style="font-family:Montserrat; font-size:28px; color:#0f172a; margin-top:18px;">Awards</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#334155;">Engineering Excellence Award - NovaCloud Systems (2024), Product Innovation Spotlight - AtlasWorks (2021)</p>',
  },
  {
    id: 'letter',
    title: 'Letter',
    description: 'Formal letter format for official communication.',
    icon: 'mail',
    content:
      '<h1 style="font-family:Montserrat; font-size:36px; color:#0f172a; margin-bottom:4px;">Olivia Bennett</h1>' +
      '<p style="font-family:Raleway; font-size:14px; color:#0f766e;">Strategic Partnerships Lead | olivia.bennett@example.com | +1 (628) 555-0112</p>' +
      '<p style="font-family:Raleway; font-size:14px; color:#475569;">1450 Market Street, Suite 320, San Francisco, CA 94103</p>' +
      '<p style="font-family:Raleway; font-size:14px; color:#334155; text-align:right;"><strong>Date:</strong> April 27, 2026</p>' +
      '<h2 style="font-family:Montserrat; font-size:24px; color:#155e75; margin-top:16px;">Recipient</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#334155;"><strong>Jordan Miller</strong><br/>Director of Operations<br/>Northstar Innovation Group<br/>880 Mission Bay Blvd, San Francisco, CA 94158</p>' +
      '<h2 style="font-family:Montserrat; font-size:24px; color:#155e75; margin-top:16px;">Subject</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#0f172a;"><strong>Proposal for Strategic Product Collaboration</strong></p>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; margin-top:14px;">Dear Jordan,</p>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">I hope you are doing well. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent fermentum sem non tortor volutpat, id varius enim hendrerit. Nunc iaculis efficitur nisl, sed sodales sem faucibus sit amet.</p>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">Our team would value the opportunity to collaborate with Northstar Innovation Group on a cross-functional initiative focused on workflow modernization. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">Key collaboration outcomes we can target together:</p>' +
      '<ul>' +
      '<li>Design and launch a pilot in under 6 weeks with measurable operational impact.</li>' +
      '<li>Improve process visibility across leadership and delivery teams.</li>' +
      '<li>Build a scalable implementation playbook for future expansion.</li>' +
      '</ul>' +
        '<h2 style="font-family:Montserrat; font-size:22px; color:#155e75; margin-top:16px;">Proposed Collaboration Timeline</h2>' +
        '<p style="font-family:Raleway; font-size:15px; color:#334155; line-height:1.7;"><strong>Week 1:</strong> Discovery workshop with stakeholders to map current workflows and define success metrics.</p>' +
        '<p style="font-family:Raleway; font-size:15px; color:#334155; line-height:1.7;"><strong>Weeks 2-4:</strong> Pilot implementation with weekly checkpoints, risk reviews, and stakeholder demos.</p>' +
        '<p style="font-family:Raleway; font-size:15px; color:#334155; line-height:1.7;"><strong>Weeks 5-6:</strong> Outcome assessment, optimization pass, and rollout recommendation report.</p>' +
        '<h2 style="font-family:Montserrat; font-size:22px; color:#155e75; margin-top:16px;">Why This Partnership</h2>' +
        '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi tristique arcu vitae mi ultrices, sit amet vulputate tortor porta. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Sed eget augue non risus feugiat tempus.</p>' +
        '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">Nam sodales, odio ut egestas auctor, sapien justo consequat turpis, vitae ultrices lectus dui non nibh. Integer suscipit, ipsum in convallis bibendum, nibh leo luctus purus, in auctor erat lacus et metus.</p>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">Please let me know a convenient time next week for a brief discussion. I would be delighted to tailor a plan specific to your team goals.</p>' +
        '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">You can reach me directly at olivia.bennett@example.com or +1 (628) 555-0112. I am also happy to share a one-page executive brief in advance of our meeting.</p>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; margin-top:16px;">Sincerely,</p>' +
        '<p style="font-family:Raleway; font-size:16px; color:#0f172a;"><strong>Olivia Bennett</strong><br/>Strategic Partnerships Lead<br/>Northstar Alliances</p>' +
        '<p style="font-family:Raleway; font-size:13px; color:#64748b; margin-top:12px;">P.S. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quisque sit amet vestibulum mauris.</p>',
  },
  {
    id: 'proposal',
    title: 'Project Proposal',
    description: 'Structured proposal with goals, scope, and timeline.',
    icon: 'description',
    content:
      '<h1 style="font-family:Montserrat; font-size:38px; color:#0f172a; margin-bottom:6px;">Project Proposal</h1>' +
      '<p style="font-family:Raleway; font-size:15px; color:#0f766e;">Digital Workflow Modernization Program | Prepared by Strategy & Delivery Office</p>' +
      '<p style="font-family:Raleway; font-size:14px; color:#475569;"><strong>Prepared for:</strong> Executive Leadership Team | <strong>Date:</strong> April 27, 2026</p>' +

      '<h2 style="font-family:Montserrat; font-size:26px; color:#155e75; margin-top:18px;">Executive Summary</h2>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">This proposal outlines a phased initiative to modernize internal workflows, reduce process friction, and improve cross-functional visibility. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae purus non nisl posuere porta at et sem.</p>' +

      '<h2 style="font-family:Montserrat; font-size:26px; color:#155e75; margin-top:18px;">Business Objectives</h2>' +
      '<ul>' +
      '<li>Reduce average handoff delays by 30% within two quarters.</li>' +
      '<li>Improve operational reporting accuracy and real-time visibility.</li>' +
      '<li>Standardize execution across product, operations, and customer success.</li>' +
      '</ul>' +

      '<h2 style="font-family:Montserrat; font-size:26px; color:#155e75; margin-top:18px;">Problem Statement</h2>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">Current delivery operations rely on fragmented tools and manual coordination, leading to inconsistent reporting and avoidable delays. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>' +

      '<h2 style="font-family:Montserrat; font-size:26px; color:#155e75; margin-top:18px;">Project Scope</h2>' +
      '<h3 style="font-family:Montserrat; font-size:21px; color:#0f172a;">In Scope</h3>' +
      '<ul>' +
      '<li>Workflow mapping and process redesign for priority teams.</li>' +
      '<li>Unified dashboard implementation and automated status tracking.</li>' +
      '<li>Role-based governance and audit-ready change controls.</li>' +
      '</ul>' +
      '<h3 style="font-family:Montserrat; font-size:21px; color:#0f172a;">Out of Scope</h3>' +
      '<ul>' +
      '<li>Legacy CRM migration and custom ERP integrations in Phase 1.</li>' +
      '<li>Global policy harmonization outside pilot business units.</li>' +
      '</ul>' +

      '<h2 style="font-family:Montserrat; font-size:26px; color:#155e75; margin-top:18px;">Delivery Plan & Milestones</h2>' +
      '<table style="width:100%; border-collapse:collapse; border:1px solid #0ea5e9; margin:8px 0; font-family:Raleway; font-size:14px; color:#0f172a;">' +
      '<thead><tr>' +
      '<th style="border:1px solid #0ea5e9; padding:8px 10px; text-align:left; color:#155e75;">Phase</th>' +
      '<th style="border:1px solid #0ea5e9; padding:8px 10px; text-align:left; color:#155e75;">Duration</th>' +
      '<th style="border:1px solid #0ea5e9; padding:8px 10px; text-align:left; color:#155e75;">Key Outcome</th>' +
      '</tr></thead>' +
      '<tbody>' +
      '<tr>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Discovery & Alignment</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Weeks 1-2</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Validated requirements, baseline metrics, stakeholder sign-off</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Implementation</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Weeks 3-8</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Pilot rollout, process automation, dashboard release</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Stabilization</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Weeks 9-10</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">KPI review, optimization actions, handover pack</td>' +
      '</tr>' +
      '</tbody></table>' +

      '<h2 style="font-family:Montserrat; font-size:26px; color:#155e75; margin-top:18px;">Budget Estimate</h2>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;"><strong>Estimated total:</strong> $185,000 (implementation + enablement). Includes delivery team allocation, training, and first-quarter support.</p>' +

      '<h2 style="font-family:Montserrat; font-size:26px; color:#155e75; margin-top:18px;">Risks & Mitigations</h2>' +
      '<ul>' +
      '<li><strong>Adoption risk:</strong> mitigated by staged onboarding and champion network model.</li>' +
      '<li><strong>Data consistency risk:</strong> mitigated by validation checkpoints and quality gates.</li>' +
      '<li><strong>Timeline risk:</strong> mitigated by weekly governance and dependency tracking.</li>' +
      '</ul>' +

      '<h2 style="font-family:Montserrat; font-size:26px; color:#155e75; margin-top:18px;">Success Metrics</h2>' +
      '<ul>' +
      '<li>Cycle time reduction from request intake to delivery completion.</li>' +
      '<li>Decrease in manual status updates and escalation events.</li>' +
      '<li>Stakeholder satisfaction score improvement (target: +20%).</li>' +
      '</ul>' +

      '<h2 style="font-family:Montserrat; font-size:26px; color:#155e75; margin-top:18px;">Approval & Next Steps</h2>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">Upon approval, the team will initiate Discovery & Alignment within 5 business days and publish the detailed implementation calendar.</p>' +
      '<p style="font-family:Raleway; font-size:15px; color:#64748b; margin-top:10px;">Prepared by: Program Management Office | Contact: pmo@example.com</p>',
  },
  {
    id: 'meeting-notes',
    title: 'Meeting Notes',
    description: 'Capture agenda, decisions, and action items quickly.',
    icon: 'event_note',
    content:
      '<h1 style="font-family:Montserrat; font-size:36px; color:#0f172a; margin-bottom:6px;">Meeting Notes</h1>' +
      '<p style="font-family:Raleway; font-size:14px; color:#0f766e;">Weekly Product & Delivery Sync</p>' +
      '<p style="font-family:Raleway; font-size:14px; color:#334155;"><strong>Date:</strong> April 27, 2026 | <strong>Time:</strong> 10:00 AM - 11:00 AM | <strong>Location:</strong> Zoom</p>' +
      '<p style="font-family:Raleway; font-size:14px; color:#334155;"><strong>Facilitator:</strong> Priya Shah | <strong>Notetaker:</strong> Marco Ellis</p>' +

      '<h2 style="font-family:Montserrat; font-size:24px; color:#155e75; margin-top:16px;">Attendees</h2>' +
      '<ul>' +
      '<li>Priya Shah - Product Lead</li>' +
      '<li>Marco Ellis - Engineering Manager</li>' +
      '<li>Elena Diaz - UX Designer</li>' +
      '<li>Jon Park - QA Lead</li>' +
      '<li>Ravi Menon - Operations Analyst</li>' +
      '</ul>' +

      '<h2 style="font-family:Montserrat; font-size:24px; color:#155e75; margin-top:16px;">Agenda</h2>' +
      '<ol>' +
      '<li>Status updates by workstream (Product, Engineering, QA)</li>' +
      '<li>Milestone readiness for next release candidate</li>' +
      '<li>Open risks, blockers, and dependency review</li>' +
      '<li>Decision log and approvals</li>' +
      '</ol>' +

      '<h2 style="font-family:Montserrat; font-size:24px; color:#155e75; margin-top:16px;">Discussion Summary</h2>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">The team reviewed sprint progress and confirmed that core development tasks are 85% complete. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.</p>' +
      '<p style="font-family:Raleway; font-size:16px; color:#334155; line-height:1.7;">QA highlighted regression risk around authentication edge cases, and operations requested enhanced release communication for customer-facing teams. Additional test coverage and an updated rollout checklist were agreed upon.</p>' +

      '<h2 style="font-family:Montserrat; font-size:24px; color:#155e75; margin-top:16px;">Decisions Made</h2>' +
      '<ul>' +
      '<li>Proceed with release candidate build on Friday, pending QA sign-off by EOD Thursday.</li>' +
      '<li>Adopt phased rollout: internal users first, then 20% external cohort.</li>' +
      '<li>Require a final cross-team readiness check 24 hours before launch.</li>' +
      '</ul>' +

      '<h2 style="font-family:Montserrat; font-size:24px; color:#155e75; margin-top:16px;">Action Items</h2>' +
      '<table style="width:100%; border-collapse:collapse; border:1px solid #0ea5e9; margin:8px 0; font-family:Raleway; font-size:14px; color:#0f172a;">' +
      '<thead><tr>' +
      '<th style="border:1px solid #0ea5e9; padding:8px 10px; text-align:left; color:#155e75;">Owner</th>' +
      '<th style="border:1px solid #0ea5e9; padding:8px 10px; text-align:left; color:#155e75;">Task</th>' +
      '<th style="border:1px solid #0ea5e9; padding:8px 10px; text-align:left; color:#155e75;">Due Date</th>' +
      '<th style="border:1px solid #0ea5e9; padding:8px 10px; text-align:left; color:#155e75;">Status</th>' +
      '</tr></thead>' +
      '<tbody>' +
      '<tr>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Jon Park</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Complete auth regression suite and share report</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Apr 30, 2026</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px; color:#155e75; font-weight:700;">In Progress</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Ravi Menon</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Publish rollout communication draft</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">May 1, 2026</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px; color:#0f766e; font-weight:700;">Planned</td>' +
      '</tr>' +
      '<tr>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Priya Shah</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">Run final readiness review with all leads</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px;">May 2, 2026</td>' +
      '<td style="border:1px solid #bae6fd; padding:8px 10px; color:#0f766e; font-weight:700;">Planned</td>' +
      '</tr>' +
      '</tbody></table>' +

      '<h2 style="font-family:Montserrat; font-size:24px; color:#155e75; margin-top:16px;">Risks & Blockers</h2>' +
      '<ul>' +
      '<li>Potential delay in API dependency deployment for reporting module.</li>' +
      '<li>Pending legal review of updated external release notes.</li>' +
      '</ul>' +

      '<h2 style="font-family:Montserrat; font-size:24px; color:#155e75; margin-top:16px;">Next Meeting</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#334155;"><strong>Date:</strong> May 4, 2026 | <strong>Focus:</strong> Release readiness final checkpoint</p>' +
      '<p style="font-family:Raleway; font-size:13px; color:#64748b; margin-top:10px;">Template tip: Duplicate the action table each week to maintain historical tracking.</p>',
  },
  {
    id: 'two-column-newsletter',
    title: 'Two-Column Newsletter',
    description: 'Editorial-style newsletter with a bold dual-column layout.',
    icon: 'newspaper',
    content:
      '<h1 style="font-family:Montserrat; font-size:34px; color:#7c2d12; margin-bottom:6px;">Weekly Team Newsletter</h1>' +
      '<p style="font-family:Raleway; font-size:14px; color:#9a3412;">Issue 18 | April 2026</p>' +
      '<table style="width:680px; max-width:100%; table-layout:fixed; border-collapse:collapse; border:1px solid #fdba74; margin:8px auto;">' +
      '<tr>' +
      '<td style="width:34%; vertical-align:top; border:1px solid #fed7aa; padding:12px;">' +
      '<h2 style="font-family:Montserrat; font-size:20px; color:#9a3412; margin:0 0 8px;">Quick Highlights</h2>' +
      '<ul>' +
      '<li>Release train shipped ahead of schedule.</li>' +
      '<li>Customer satisfaction improved by 12%.</li>' +
      '<li>Design system v3 now available.</li>' +
      '</ul>' +
      '<h2 style="font-family:Montserrat; font-size:20px; color:#9a3412; margin:14px 0 8px;">Upcoming</h2>' +
      '<p style="font-family:Raleway; font-size:14px; color:#7c2d12;">Townhall on Friday, 3:00 PM.<br/>Hackday next Tuesday.<br/>Hiring panel workshop next week.</p>' +
      '</td>' +
      '<td style="width:66%; vertical-align:top; border:1px solid #fde68a; padding:12px;">' +
      '<h2 style="font-family:Montserrat; font-size:22px; color:#92400e; margin:0 0 8px;">Feature Story</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#78350f; line-height:1.7;">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum mattis, felis in pharetra fermentum, purus tortor efficitur ligula, eu pellentesque libero mauris vel justo. Integer commodo nisi in arcu faucibus consequat.</p>' +
      '<h2 style="font-family:Montserrat; font-size:22px; color:#92400e; margin:14px 0 8px;">Team Wins</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#78350f; line-height:1.7;">Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.</p>' +
      '</td>' +
      '</tr>' +
      '</table>',
  },
  {
    id: 'two-column-launch-brief',
    title: 'Launch Brief (Split)',
    description: 'Green themed launch plan with left nav panel and right detail panel.',
    icon: 'rocket_launch',
    content:
      '<h1 style="font-family:Montserrat; font-size:34px; color:#064e3b; margin-bottom:6px;">Product Launch Brief</h1>' +
      '<p style="font-family:Raleway; font-size:14px; color:#047857;">Q2 Go-to-Market | Owner: Growth Team</p>' +
      '<table style="width:680px; max-width:100%; table-layout:fixed; border-collapse:collapse; border:1px solid #86efac; margin:8px auto;">' +
      '<tr>' +
      '<td style="width:36%; vertical-align:top; border:1px solid #a7f3d0; padding:12px;">' +
      '<h2 style="font-family:Montserrat; font-size:20px; color:#065f46; margin:0 0 8px;">Launch Checklist</h2>' +
      '<ul>' +
      '<li>Messaging approved</li>' +
      '<li>Sales enablement complete</li>' +
      '<li>Support runbook reviewed</li>' +
      '<li>Analytics dashboards verified</li>' +
      '</ul>' +
      '<h2 style="font-family:Montserrat; font-size:20px; color:#065f46; margin:14px 0 8px;">Stakeholders</h2>' +
      '<p style="font-family:Raleway; font-size:14px; color:#065f46;">PM: A. Stone<br/>Marketing: C. Patel<br/>Sales: M. Green<br/>Support: L. Rivera</p>' +
      '</td>' +
      '<td style="width:64%; vertical-align:top; border:1px solid #bbf7d0; padding:12px;">' +
      '<h2 style="font-family:Montserrat; font-size:22px; color:#166534; margin:0 0 8px;">Objective</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#14532d; line-height:1.7;">Launch the new onboarding suite to increase trial-to-paid conversion by 15% within 60 days. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>' +
      '<h2 style="font-family:Montserrat; font-size:22px; color:#166534; margin:14px 0 8px;">Execution Plan</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#14532d; line-height:1.7;">Week 1: audience priming and landing page updates.<br> Week 2: feature education campaign and webinar.<br> Week 3: targeted outreach and partner amplification. Week 4: performance review and optimization pass.</p>' +
      '</td>' +
      '</tr>' +
      '</table>',
  },
  {
    id: 'two-column-case-study',
    title: 'Case Study (Split)',
    description: 'Indigo editorial case study with sidebar facts and main narrative.',
    icon: 'auto_stories',
    content:
      '<h1 style="font-family:Montserrat; font-size:34px; color:#1e1b4b; margin-bottom:6px;">Customer Success Case Study</h1>' +
      '<p style="font-family:Raleway; font-size:14px; color:#4338ca;">How Northstar reduced resolution time by 43%</p>' +
      '<table style="width:680px; max-width:100%; table-layout:fixed; border-collapse:collapse; border:1px solid #c7d2fe; margin:8px auto;">' +
      '<tr>' +
      '<td style="width:33%; vertical-align:top; border:1px solid #c7d2fe; padding:12px;">' +
      '<h2 style="font-family:Montserrat; font-size:20px; color:#312e81; margin:0 0 8px;">At A Glance</h2>' +
      '<p style="font-family:Raleway; font-size:14px; color:#3730a3;"><strong>Industry:</strong> SaaS<br/><strong>Company Size:</strong> 1,200+<br/><strong>Timeline:</strong> 10 weeks<br/><strong>Primary KPI:</strong> MTTR</p>' +
      '<h2 style="font-family:Montserrat; font-size:20px; color:#312e81; margin:14px 0 8px;">Results</h2>' +
      '<ul>' +
      '<li>43% faster issue resolution</li>' +
      '<li>28% fewer escalations</li>' +
      '<li>17-point CSAT improvement</li>' +
      '</ul>' +
      '</td>' +
      '<td style="width:67%; vertical-align:top; border:1px solid #e0e7ff; padding:12px;">' +
      '<h2 style="font-family:Montserrat; font-size:22px; color:#3730a3; margin:0 0 8px;">Challenge</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#312e81; line-height:1.7;">The support organization managed complex workflows across disconnected tools, creating delays and inconsistent ownership. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur sed purus in erat ultrices aliquet.</p>' +
      '<h2 style="font-family:Montserrat; font-size:22px; color:#3730a3; margin:14px 0 8px;">Approach</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#312e81; line-height:1.7;">We introduced role-based triage queues, standardized incident playbooks, and real-time performance dashboards. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.</p>' +
      '<h2 style="font-family:Montserrat; font-size:22px; color:#3730a3; margin:14px 0 8px;">Outcome</h2>' +
      '<p style="font-family:Raleway; font-size:15px; color:#312e81; line-height:1.7;">Within one quarter, leadership gained visibility into bottlenecks and teams reduced cycle time materially, enabling faster customer response and improved NPS.</p>' +
      '</td>' +
      '</tr>' +
      '</table>',
  },
];

router.get('/', requireAuth, resolveOrganizationContext, requirePermission('document.read'), async (_req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.json({ templates: TEMPLATES });
  }

  const cachedTemplates = readTemplateCache();
  if (cachedTemplates) {
    return res.json({ templates: cachedTemplates });
  }

  try {
    const dbTemplates = await prisma.template.findMany({
      select: {
        id: true,
        title: true,
        description: true,
        icon: true,
        content: true,
      },
      orderBy: { title: 'asc' },
    });

    writeTemplateCache(dbTemplates);

    return res.json({ templates: dbTemplates });
  } catch {
    return res.json({ templates: TEMPLATES });
  }
});

router.TEMPLATES = TEMPLATES;

module.exports = router;
