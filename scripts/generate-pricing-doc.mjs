import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  TableLayoutType, ShadingType
} from 'docx';
import { writeFileSync } from 'fs';

const BRAND = '#5b6cf9';
const GRAY = '#6b7280';
const LIGHT = '#f9fafb';
const WHITE = '#FFFFFF';
const GREEN = '#16a34a';

function heading1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
  });
}

function heading2(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
  });
}

function heading3(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
  });
}

function para(text, { bold = false, color, italic = false, spacing } = {}) {
  return new Paragraph({
    children: [new TextRun({ text, bold, color: color?.replace('#',''), italics: italic, size: 22 })],
    spacing: spacing ?? { before: 80, after: 80 },
  });
}

function bullet(text) {
  return new Paragraph({
    text,
    bullet: { level: 0 },
    spacing: { before: 60, after: 60 },
  });
}

function blankLine() {
  return new Paragraph({ text: '', spacing: { before: 100, after: 100 } });
}

function cell(text, { bold = false, shade = false, color, width } = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: String(text), bold, color: color?.replace('#',''), size: 20 })],
      alignment: AlignmentType.LEFT,
      spacing: { before: 60, after: 60 },
    })],
    shading: shade ? { fill: 'F3F4F6', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
  });
}

function headerCell(text, width) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: String(text), bold: true, color: 'FFFFFF', size: 20 })],
      alignment: AlignmentType.LEFT,
      spacing: { before: 60, after: 60 },
    })],
    shading: { fill: '5b6cf9', type: ShadingType.CLEAR, color: 'auto' },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
  });
}

function makeTable(headers, rows, widths) {
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: headers.map((h, i) => headerCell(h, widths?.[i])),
        tableHeader: true,
      }),
      ...rows.map((row, ri) =>
        new TableRow({
          children: row.map((c, ci) => cell(c, { bold: ci === 0, shade: ri % 2 === 1 })),
        })
      ),
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      insideH: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
      insideV: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
    },
  });
}

// ─── Build Document ──────────────────────────────────────────────────────────

const doc = new Document({
  styles: {
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        run: { size: 36, bold: true, color: '111827' },
        paragraph: { spacing: { before: 400, after: 200 } },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        run: { size: 28, bold: true, color: '1f2937' },
        paragraph: { spacing: { before: 300, after: 150 } },
      },
      {
        id: 'Heading3',
        name: 'Heading 3',
        run: { size: 24, bold: true, color: '374151' },
        paragraph: { spacing: { before: 200, after: 100 } },
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
      },
    },
    children: [

      // ── Title ──────────────────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: 'Dakyworld Hub', bold: true, size: 52, color: '5b6cf9' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 100 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Pricing Financial Model', bold: true, size: 40, color: '111827' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 100 },
      }),
      new Paragraph({
        children: [new TextRun({ text: 'Version 1.0  |  May 2026  |  Confidential', size: 20, color: '6B7280', italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 400 },
      }),

      // ── Executive Summary ──────────────────────────────────────────────
      heading1('Executive Summary'),
      makeTable(
        ['Metric', 'Value'],
        [
          ['Plans', 'Free · Pro · Agency'],
          ['Break-even', '7 total users'],
          ['Gross margin at scale', '~70%'],
          ['ARR at 1,000 users', '$215,160'],
          ['ARR at 10,000 users', '$2,151,600'],
        ],
        [40, 60]
      ),
      blankLine(),

      // ── Plans at a Glance ──────────────────────────────────────────────
      heading1('Plans at a Glance'),
      makeTable(
        ['Plan', 'Monthly', 'Annual (/mo)', 'Credits', 'AI Access'],
        [
          ['Free', '$0', '$0', '100 cr', 'Text only'],
          ['Pro ★', '$29', '$23', '2,000 cr', 'Images (6 models)'],
          ['Agency', '$79', '$63', '6,000 cr', 'Images + Video + Editing'],
        ],
        [15, 15, 20, 15, 35]
      ),
      para('Annual discount: 20% off — billed as $276/yr (Pro) · $756/yr (Agency)', { italic: true }),
      blankLine(),

      // ── Section 1 ─────────────────────────────────────────────────────
      heading1('Section 1 — Unit Economics'),

      heading2('Assumed User Distribution'),
      para('Based on freemium SaaS industry benchmarks.'),
      makeTable(
        ['Tier', 'Share', 'Billed Monthly', 'Billed Annually'],
        [
          ['Free', '60%', '—', '—'],
          ['Pro', '25%', '70%', '30%'],
          ['Agency', '15%', '70%', '30%'],
        ],
        [20, 20, 30, 30]
      ),
      blankLine(),
      heading3('Blended monthly revenue per tier'),
      bullet('Pro → (70% × $29) + (30% × $23) = $27.20 / user / month'),
      bullet('Agency → (70% × $79) + (30% × $63) = $74.20 / user / month'),
      blankLine(),

      heading2('Magnific API Cost Estimates'),
      para('These are estimates based on comparable AI APIs (Replicate, FAL.ai, Together AI). Verify actuals in your Magnific dashboard each month.', { italic: true }),

      heading3('Free User — ~60 credits used (60% utilization)'),
      makeTable(
        ['Action', 'Calls', 'Cost / Call', 'Monthly Total'],
        [
          ['AI text posts', '60', '$0.001', '$0.06'],
          ['Total API cost', '', '', '~$0.10'],
        ],
        [40, 20, 20, 20]
      ),
      blankLine(),

      heading3('Pro User — ~1,300 credits used (65% utilization)'),
      makeTable(
        ['Action', 'Credits', 'Calls', 'Cost / Call', 'Monthly Total'],
        [
          ['AI text posts', '650 cr', '650', '$0.001', '$0.65'],
          ['Image — fast tier (Flux Turbo)', '390 cr', '130', '$0.015', '$1.95'],
          ['Image — quality tier (Flux Pro)', '195 cr', '39', '$0.025', '$0.98'],
          ['Image editing tools', '65 cr', '22', '$0.020', '$0.44'],
          ['Total API cost', '', '', '', '~$4.00'],
        ],
        [35, 15, 12, 18, 20]
      ),
      blankLine(),

      heading3('Agency User — ~4,200 credits used (70% utilization)'),
      makeTable(
        ['Action', 'Credits', 'Calls', 'Cost / Call', 'Monthly Total'],
        [
          ['AI text posts', '1,260 cr', '1,260', '$0.001', '$1.26'],
          ['Images (mixed models)', '1,680 cr', '336', '$0.025 avg', '$8.40'],
          ['Video (WAN / Kling mix)', '840 cr', '~31 clips', '$0.45 avg', '$13.95'],
          ['Image editing tools', '420 cr', '140', '$0.020', '$2.80'],
          ['Total API cost', '', '', '', '~$26.40'],
        ],
        [35, 15, 12, 18, 20]
      ),
      para('Video is the largest cost driver. Kling 3 Pro alone can cost ~$0.60/clip. The 6,000-credit cap on Agency limits worst-case exposure to ~$45/month.', { italic: true }),
      blankLine(),

      heading2('Infrastructure (Shared Platform)'),
      makeTable(
        ['Item', 'Monthly Estimate'],
        [
          ['App server (Railway / Render)', '$20 – $30'],
          ['PostgreSQL database', '$15 – $25'],
          ['CDN + file storage (S3)', '$5 – $15'],
          ['Domain, SSL, misc', '$5'],
          ['Fixed base total', '~$80 / mo'],
          ['Per-user variable (bandwidth, compute)', '$0.15 / user / mo'],
        ],
        [70, 30]
      ),
      blankLine(),

      heading2('Gross Profit Per User'),
      makeTable(
        ['Plan', 'Revenue / mo', 'API Cost', 'Infra', 'Total Cost', 'Gross Profit', 'Margin'],
        [
          ['Free', '$0', '$0.10', '$0.15', '$0.25', '–$0.25', '—'],
          ['Pro', '$27.20', '$4.00', '$0.15', '$4.15', '$23.05', '85%'],
          ['Agency', '$74.20', '$26.40', '$0.15', '$26.55', '$47.65', '64%'],
        ],
        [15, 15, 13, 10, 14, 18, 15]
      ),
      blankLine(),
      para('Blended variable cost: (0.60 × $0.25) + (0.25 × $4.15) + (0.15 × $26.55) = $5.17 / user / mo'),
      para('Blended revenue: (0.60 × $0) + (0.25 × $27.20) + (0.15 × $74.20) = $17.93 / user / mo'),
      para('Break-even point: 7 total users — $80 fixed ÷ ($17.93 − $5.17) = 6.3 users', { bold: true }),
      blankLine(),

      // ── Section 2 ─────────────────────────────────────────────────────
      heading1('Section 2 — Scenario Analysis'),
      para('Assumptions: 60 / 25 / 15 plan split · 70 / 30 monthly / annual billing mix', { italic: true }),
      para('"Annual P&L" = Monthly P&L × 12 (revenue recognized monthly regardless of billing cycle)', { italic: true }),
      blankLine(),

      // 10 Users
      heading2('10 Users  (6 Free · 2–3 Pro · 1–2 Agency)'),
      makeTable(
        ['', 'Monthly', 'Annual'],
        [
          ['Gross Revenue', '$179', '$2,152'],
          ['Magnific API', '–$46', '–$552'],
          ['Infrastructure', '–$82', '–$984'],
          ['Total Costs', '$128', '$1,536'],
          ['Net Profit', '$51', '$612'],
          ['Profit Margin', '28%', '28%'],
        ],
        [40, 30, 30]
      ),
      blankLine(),
      makeTable(
        ['Metric', 'Value'],
        [
          ['MRR', '$179'],
          ['Paying users', '~4'],
          ['ARPU (all users)', '$17.90'],
          ['ARPU (paying only)', '$44.80'],
        ],
        [60, 40]
      ),
      blankLine(),

      // 100 Users
      heading2('100 Users  (60 Free · 25 Pro · 15 Agency)'),
      makeTable(
        ['', 'Monthly', 'Annual'],
        [
          ['Gross Revenue', '$1,793', '$21,516'],
          ['Magnific API', '–$517', '–$6,204'],
          ['Infrastructure', '–$95', '–$1,140'],
          ['Total Costs', '$612', '$7,344'],
          ['Net Profit', '$1,181', '$14,172'],
          ['Profit Margin', '66%', '66%'],
        ],
        [40, 30, 30]
      ),
      blankLine(),
      makeTable(
        ['Metric', 'Value'],
        [
          ['MRR', '$1,793'],
          ['Paying users', '40'],
          ['ARPU (all users)', '$17.93'],
          ['ARPU (paying only)', '$44.83'],
        ],
        [60, 40]
      ),
      blankLine(),

      // 1,000 Users
      heading2('1,000 Users  (600 Free · 250 Pro · 150 Agency)'),
      makeTable(
        ['', 'Monthly', 'Annual'],
        [
          ['Gross Revenue', '$17,930', '$215,160'],
          ['Magnific API', '–$5,170', '–$62,040'],
          ['Infrastructure', '–$230', '–$2,760'],
          ['Total Costs', '$5,400', '$64,800'],
          ['Net Profit', '$12,530', '$150,360'],
          ['Profit Margin', '70%', '70%'],
        ],
        [40, 30, 30]
      ),
      blankLine(),
      makeTable(
        ['Metric', 'Value'],
        [
          ['MRR', '$17,930'],
          ['ARR', '$215,160'],
          ['Paying users', '400'],
          ['ARPU (paying only)', '$44.83'],
        ],
        [60, 40]
      ),
      blankLine(),

      // 10,000 Users
      heading2('10,000 Users  (6,000 Free · 2,500 Pro · 1,500 Agency)'),
      makeTable(
        ['', 'Monthly', 'Annual'],
        [
          ['Gross Revenue', '$179,300', '$2,151,600'],
          ['Magnific API', '–$51,700', '–$620,400'],
          ['Infrastructure', '–$1,580', '–$18,960'],
          ['Total Costs', '$53,280', '$639,360'],
          ['Net Profit', '$126,020', '$1,512,240'],
          ['Profit Margin', '70%', '70%'],
        ],
        [40, 30, 30]
      ),
      blankLine(),
      makeTable(
        ['Metric', 'Value'],
        [
          ['MRR', '$179,300'],
          ['ARR', '$2,151,600'],
          ['Paying users', '4,000'],
          ['ARPU (paying only)', '$44.83'],
        ],
        [60, 40]
      ),
      blankLine(),

      // ── Section 3 Master Summary ───────────────────────────────────────
      heading1('Section 3 — Master Summary'),
      makeTable(
        ['Users', 'MRR', 'Monthly Cost', 'Monthly Profit', 'ARR', 'Annual Profit', 'Margin'],
        [
          ['10', '$179', '$128', '$51', '$2,152', '$612', '28%'],
          ['100', '$1,793', '$612', '$1,181', '$21,516', '$14,172', '66%'],
          ['1,000', '$17,930', '$5,400', '$12,530', '$215,160', '$150,360', '70%'],
          ['10,000', '$179,300', '$53,280', '$126,020', '$2,151,600', '$1,512,240', '70%'],
        ],
        [10, 14, 15, 15, 16, 16, 14]
      ),
      blankLine(),
      bullet('Margin jumps from 28% → 66% between 10 and 100 users as fixed infra ($80/mo) gets amortized.'),
      bullet('Margin stabilizes at ~70% from 1,000 users onward — the business scales cleanly.'),
      blankLine(),

      // ── Section 4 Annual Billing Cash Flow ────────────────────────────
      heading1('Section 4 — Annual Billing Cash Flow Bonus'),
      para('Paying annually upfront delivers a cash advance that can fund operations or marketing.'),
      makeTable(
        ['Plan', 'Annual Price', 'Upfront Cash', 'vs. Monthly (12 mo)', 'Discount Cost'],
        [
          ['Pro Annual', '$276', '$276 on day 1', '$348 monthly × 12', '–$72 / user'],
          ['Agency Annual', '$756', '$756 on day 1', '$948 monthly × 12', '–$192 / user'],
        ],
        [20, 20, 20, 25, 15]
      ),
      blankLine(),
      heading3('Upfront Cash at 30% Annual Conversion'),
      makeTable(
        ['Users', 'Pro Annual Subscribers', 'Agency Annual Subscribers', 'Upfront Cash (Month 1)'],
        [
          ['100', '7–8', '4–5', '~$5,600'],
          ['1,000', '75', '45', '~$54,720'],
          ['10,000', '750', '450', '~$547,200'],
        ],
        [15, 25, 30, 30]
      ),
      para('This cash can cover ~7 months of infrastructure costs at 1,000 users.', { italic: true }),
      blankLine(),

      // ── Section 5 Risk & Levers ────────────────────────────────────────
      heading1('Section 5 — Risk & Levers'),

      heading2('Risk Factors'),
      makeTable(
        ['Risk', 'Likelihood', 'Impact', 'Mitigation'],
        [
          ['Agency users max out video credits', 'Medium', 'API cost → $45–50/mo per user', 'Add video credit sub-cap (e.g., max 50 video cr/mo)'],
          ['Free → Paid conversion below 35%', 'Medium', 'Lower ARPU, slower growth', 'Stronger onboarding, limited free tier features'],
          ['Magnific API price increase', 'Low', 'Margin compression on all tiers', 'Negotiate annual contract at volume; adjust credit costs'],
          ['Churn above 10%/month', 'Medium', 'MRR erosion', 'Push annual billing; improve product stickiness'],
          ['Competitor undercuts price', 'Low', 'Pricing pressure', 'Differentiate on model breadth and ease of use'],
        ],
        [30, 15, 25, 30]
      ),
      blankLine(),

      heading2('Growth Levers (ranked by impact)'),
      makeTable(
        ['#', 'Lever', 'Effect'],
        [
          ['1', 'Convert Free → Pro', 'Each conversion adds $23/mo net profit'],
          ['2', 'Push annual billing', '30% → 50% annual mix adds ~$0.75/user/mo; improves cashflow'],
          ['3', 'Reduce Agency video waste', 'Sub-cap saves $15–20/mo per heavy video user'],
          ['4', 'Upsell Pro → Agency', 'Adds $47.65/mo gross profit per upgrade'],
          ['5', 'Claude API prompt caching', 'Nova workflow cached prompts reduce Claude API costs'],
        ],
        [8, 35, 57]
      ),
      blankLine(),

      heading2('Break-Even Reference'),
      makeTable(
        ['Scenario', 'Users Needed'],
        [
          ['Cover fixed infra ($80/mo)', '7 users'],
          ['$1,000/mo profit', '85 users'],
          ['$10,000/mo profit', '860 users'],
          ['$100,000/mo profit', '7,900 users'],
        ],
        [70, 30]
      ),
      para('Formula: N = (Target Profit + $80) ÷ $12.76  (net contribution per user after variable costs)', { italic: true }),
      blankLine(),

      // ── Footer note ───────────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({
          text: 'All Magnific API figures are estimates. Cross-reference against your Magnific billing dashboard monthly. Infrastructure costs scale with traffic — re-model when the platform crosses 5,000 active daily users.',
          italics: true, size: 18, color: '6B7280',
        })],
        spacing: { before: 300 },
      }),
    ],
  }],
});

// Write the file
const buf = await Packer.toBuffer(doc);
writeFileSync('D:/Saas/PRICING_FINANCIALS.docx', buf);
console.log('Created: D:/Saas/PRICING_FINANCIALS.docx');
