const nodemailer = require('nodemailer');
const mongoose   = require('mongoose');
const PDFDocument = require('pdfkit');
const FormResponse   = require('../models/FormResponse');
const TLFormResponse = require('../models/TLFormResponse');
const TeamLead       = require('../models/TeamLead');
const Employee       = require('../models/Employee');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeProduct(product) {
  if (!product || product === 'undefined' || product === 'null') return 'tide';
  let val = String(product).toLowerCase().trim();
  if (val === 'msme')                          val = 'tide msme';
  if (val === 'insurance')                     val = 'tide insurance';
  if (val === 'bt')                            val = 'tide bt';
  if (val === 'credit card' || val === 'cc')   val = 'tide credit card';
  return val || 'tide';
}

function getProductCategory(form) {
  const raw =
    form.formFillingFor ||
    form.tideProduct    ||
    form.brand          ||
    (Array.isArray(form.attemptedProducts) && form.attemptedProducts.length > 0
      ? form.attemptedProducts[0]
      : '') ||
    'tide';
  return normalizeProduct(raw);
}

// ─── Build PDF buffer in-memory (no file written to disk) ────────────────────

function buildPDFBuffer(sortedTLs, grandFTD, grandMTD, productsList, now, currentMonthName) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 0, size: 'A3', layout: 'landscape' });
    const chunks = [];

    doc.on('data',  chunk => chunks.push(chunk));
    doc.on('end',   ()    => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Colours
    const GREEN_DARK  = '#1b5e20';
    const GREEN_MID   = '#2e7d32';
    const GREEN_LIGHT = '#e8f5e9';
    const GREEN_BAND  = '#c8e6c9';
    const GREY_BG     = '#f5f5f5';
    const BLACK       = '#212121';
    const GREY_TXT    = '#666666';
    const WHITE       = '#ffffff';

    const MARGIN    = 36;
    const PAGE_W    = doc.page.width;   // A3 landscape = 1190.5
    const USABLE_W  = PAGE_W - MARGIN * 2;

    // Column widths — auto-scaled to fill full A3 landscape page (1190.5pt - 72pt margins = 1118.5pt usable)
    // TL(190) | Mgr(150) | Total(120) | Tide(115) | Insurance(115) | MSME(110) | Credit Card(115) | Tide BT(115) = 1030 — scaled up to fill page
    const SCALE   = Math.floor((doc.page.width - MARGIN * 2) / (190 + 150 + 120 + 115 + 115 + 110 + 115 + 115) * 100) / 100;
    const BASE_W  = [190, 150, 120, 115, 115, 110, 115, 115];
    const COL_W   = BASE_W.map(w => Math.round(w * SCALE));
    // Fix any rounding gap on last column
    const computed = COL_W.reduce((s, w) => s + w, 0);
    COL_W[COL_W.length - 1] += (doc.page.width - MARGIN * 2) - computed;
    const TOTAL_TW = COL_W.reduce((s, w) => s + w, 0);
    const HEADERS  = ['Team Leader', 'Manager', 'Total\nSub / Ver', 'Tide\nSub / Ver', 'Insurance\nSub / Ver', 'MSME\nSub / Ver', 'Credit Card\nSub / Ver', 'Tide BT\nSub / Ver'];

    const ROW_H    = 26;
    const HDR_H    = 32;
    const MGR_H    = 22;
    const GRAND_H  = 30;

    // ── Helpers
    function fmtCell(sub, ver) {
      return sub === 0 ? '—' : `${sub} / ${ver}`;
    }

    function drawRect(x, y, w, h, fill, stroke) {
      doc.rect(x, y, w, h).fill(fill);
      if (stroke) doc.rect(x, y, w, h).stroke(stroke);
    }

    function cellText(text, x, y, w, h, color, font, size, align = 'center') {
      doc.fillColor(color).font(font).fontSize(size);
      const lineCount = (text.match(/\n/g) || []).length + 1;
      const textH = size * lineCount * 1.25;
      const textY = y + (h - textH) / 2;
      doc.text(text, x + 4, textY, { width: w - 8, align, lineGap: 1 });
    }

    function drawTableHeader(startX, y) {
      let x = startX;
      HEADERS.forEach((h, i) => {
        drawRect(x, y, COL_W[i], HDR_H, GREEN_MID, GREEN_DARK);
        cellText(h, x, y, COL_W[i], HDR_H, WHITE, 'Helvetica-Bold', 8.5, i < 2 ? 'left' : 'center');
        x += COL_W[i];
      });
      return y + HDR_H;
    }

    function drawManagerBand(y, managerName) {
      drawRect(MARGIN, y, TOTAL_TW, MGR_H, '#d0ead0', '#a5d6a7');
      doc.fillColor(GREEN_DARK).font('Helvetica-Bold').fontSize(9)
         .text(`  Manager: ${managerName}`, MARGIN + 6, y + 6, { width: TOTAL_TW - 12, align: 'left' });
      return y + MGR_H;
    }

    function drawDataRow(y, tl, metricKey, rowIdx) {
      const m   = tl[metricKey];
      const bg  = rowIdx % 2 === 0 ? WHITE : GREY_BG;
      drawRect(MARGIN, y, TOTAL_TW, ROW_H, bg, '#e0e8e0');

      const vals = [
        `  ${tl.tlName}`,
        tl.manager,
        fmtCell(m.totalSub, m.totalVer),
        ...productsList.map(p => fmtCell(m[p].sub, m[p].ver))
      ];
      let x = MARGIN;
      vals.forEach((v, i) => {
        const isZero  = v === '—';
        const color   = isZero ? '#aaaaaa' : (i < 2 ? BLACK : GREEN_DARK);
        const font    = i < 2 ? 'Helvetica' : 'Helvetica-Bold';
        cellText(v, x, y, COL_W[i], ROW_H, color, font, 9, i < 2 ? 'left' : 'center');
        x += COL_W[i];
      });
      return y + ROW_H;
    }

    function drawGrandRow(y, grand) {
      drawRect(MARGIN, y, TOTAL_TW, GRAND_H, GREEN_LIGHT, GREEN_MID);
      const vals = [
        'OVERALL TOTAL',
        '',
        fmtCell(grand.totalSub, grand.totalVer),
        ...productsList.map(p => fmtCell(grand[p].sub, grand[p].ver))
      ];
      let x = MARGIN;
      vals.forEach((v, i) => {
        cellText(v, x, y, COL_W[i], GRAND_H, GREEN_DARK, 'Helvetica-Bold', 9.5, i < 2 ? 'left' : 'center');
        x += COL_W[i];
      });
      return y + GRAND_H;
    }

    function drawPageContent(metricKey, pageTitle, pageSubtitle, grand, isFirstPage) {
      // ── Header Banner
      let y = 0;
      drawRect(0, y, PAGE_W, 58, GREEN_DARK, null);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(20)
         .text('VEGAVRUDDHI — Daily TL Verification & Sync Report', MARGIN, 14, { width: USABLE_W });
      doc.fillColor('#c8e6c9').font('Helvetica').fontSize(10)
         .text(`Generated: ${now.toLocaleString()}  |  Report Month: ${currentMonthName}`, MARGIN, 38, { width: USABLE_W });
      y = 58;

      // ── Summary Cards (side by side)
      const cardW = (USABLE_W - 20) / 2;
      const cardH = 54;
      const cardY = y + 14;

      // Left card — FTD
      drawRect(MARGIN, cardY, cardW, cardH, GREEN_LIGHT, GREEN_BAND);
      doc.fillColor(GREEN_MID).font('Helvetica-Bold').fontSize(10)
         .text('FTD — For The Day', MARGIN + 12, cardY + 10, { width: cardW - 24 });
      doc.fillColor(BLACK).font('Helvetica').fontSize(11)
         .text(`Submitted: ${grandFTD.totalSub}   |   Verified: ${grandFTD.totalVer}`, MARGIN + 12, cardY + 30, { width: cardW - 24 });

      // Right card — MTD
      const rightX = MARGIN + cardW + 20;
      drawRect(rightX, cardY, cardW, cardH, GREEN_LIGHT, GREEN_BAND);
      doc.fillColor(GREEN_MID).font('Helvetica-Bold').fontSize(10)
         .text(`MTD — ${currentMonthName}`, rightX + 12, cardY + 10, { width: cardW - 24 });
      doc.fillColor(BLACK).font('Helvetica').fontSize(11)
         .text(`Submitted: ${grandMTD.totalSub}   |   Verified: ${grandMTD.totalVer}`, rightX + 12, cardY + 30, { width: cardW - 24 });

      y = cardY + cardH + 20;

      // ── Section title
      doc.fillColor(GREEN_DARK).font('Helvetica-Bold').fontSize(13)
         .text(pageTitle, MARGIN, y, { width: USABLE_W });
      y += 18;
      doc.fillColor(GREY_TXT).font('Helvetica').fontSize(10)
         .text(pageSubtitle, MARGIN, y, { width: USABLE_W });
      y += 18;

      // ── Table header
      y = drawTableHeader(MARGIN, y);

      // ── Data rows grouped by manager
      let lastMgr = null;
      let rowIdx  = 0;
      for (const tl of sortedTLs) {
        if (tl.manager !== lastMgr) {
          lastMgr = tl.manager;
          y = drawManagerBand(y, tl.manager);
          rowIdx = 0;
        }
        y = drawDataRow(y, tl, metricKey, rowIdx);
        rowIdx++;
      }

      // ── Grand total
      y = drawGrandRow(y, grand);

      // ── Footer
      y += 16;
      const footerText = 'Vegavruddhi IT & Business Consultation Services Pvt. Ltd.  —  Automated Daily Report  |  All figures: Submitted / Fully Verified';
      doc.fillColor(GREY_TXT).font('Helvetica').fontSize(8.5)
         .text(footerText, MARGIN, y, { width: USABLE_W, align: 'center' });
    }

    // ── PAGE 1: FTD
    drawPageContent(
      'ftd',
      'FTD Summary by Team Leader',
      `For the day: ${now.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}`,
      grandFTD,
      true
    );

    // ── PAGE 2: MTD
    doc.addPage();
    drawPageContent(
      'mtd',
      'MTD Summary by Team Leader',
      `Month to date: ${currentMonthName}`,
      grandMTD,
      false
    );

    doc.end();
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function sendManagerDailyReport() {
  try {
    console.log('Starting Manager Daily FTD & MTD Report generation...');

    const emailsStr  = process.env.MANAGER_REPORT_EMAILS || process.env.ADMIN_EMAIL || '';
    const recipients = emailsStr.split(',').map(e => e.trim()).filter(Boolean);

    if (recipients.length === 0) {
      console.warn('No MANAGER_REPORT_EMAILS or ADMIN_EMAIL configured in .env. Skipping report.');
      return { success: false, reason: 'No recipient emails configured' };
    }

    // 1. Date boundaries
    const now            = new Date();
    const startOfDay     = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const startOfMonth   = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const currentMonthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    // 2. Fetch TLs & Employees
    const [allTLs, allEmployees] = await Promise.all([
      TeamLead.find({ approvalStatus: { $ne: 'rejected' } }).lean(),
      Employee.find({ approvalStatus: { $ne: 'rejected' } }).lean()
    ]);

    if (!allTLs || allTLs.length === 0) {
      console.warn('No Team Leaders found in database.');
      return { success: false, reason: 'No Team Leaders found' };
    }

    // 3. Build TL → member map
    const tlTeamMap         = new Map();
    const allMemberNamesToTL = new Map();

    for (const tl of allTLs) {
      const tlName = (tl.name || '').trim();
      if (!tlName) continue;

      const memberNames = new Set([tlName.toLowerCase()]);
      for (const emp of allEmployees) {
        const mgrName = (emp.reportingManager || '').trim();
        const empName = (emp.newJoinerName || emp.name || '').trim();
        if (mgrName.toLowerCase() === tlName.toLowerCase() && empName) {
          memberNames.add(empName.toLowerCase());
          allMemberNamesToTL.set(empName.toLowerCase(), tlName);
        }
      }
      allMemberNamesToTL.set(tlName.toLowerCase(), tlName);
      tlTeamMap.set(tlName, { tl, memberNames });
    }

    // 4. Fetch forms this month
    const formQuery            = { createdAt: { $gte: startOfMonth } };
    const [fseForms, tlForms]  = await Promise.all([
      FormResponse.find(formQuery).lean(),
      TLFormResponse.find(formQuery).lean()
    ]);
    const allForms = [...fseForms, ...tlForms];

    const productsList   = ['tide', 'tide insurance', 'tide msme', 'tide credit card', 'tide bt'];
    const createEmptyMetrics = () => {
      const obj = { totalSub: 0, totalVer: 0 };
      productsList.forEach(p => { obj[p] = { sub: 0, ver: 0 }; });
      return obj;
    };

    const tlMetricsMap = new Map();
    for (const [tlName, { tl }] of tlTeamMap.entries()) {
      tlMetricsMap.set(tlName, {
        tlName,
        manager: tl.reportingManager || 'Direct',
        ftd: createEmptyMetrics(),
        mtd: createEmptyMetrics()
      });
    }

    // 5. Aggregate
    for (const form of allForms) {
      const empName = (form.employeeName || '').trim().toLowerCase();
      const formFor = (form.formFillingFor || '').trim();

      let targetTLName = null;
      if (formFor && tlMetricsMap.has(formFor))               targetTLName = formFor;
      else if (empName && allMemberNamesToTL.has(empName))    targetTLName = allMemberNamesToTL.get(empName);
      if (!targetTLName || !tlMetricsMap.has(targetTLName))   continue;

      const tlStats     = tlMetricsMap.get(targetTLName);
      const isFTD       = new Date(form.createdAt) >= startOfDay;
      const isVerified  = form.verificationStatus === 'Fully Verified';
      const prod        = getProductCategory(form);
      const matchedProd = productsList.includes(prod) ? prod : 'tide';

      tlStats.mtd.totalSub++;
      if (isVerified) tlStats.mtd.totalVer++;
      tlStats.mtd[matchedProd].sub++;
      if (isVerified) tlStats.mtd[matchedProd].ver++;

      if (isFTD) {
        tlStats.ftd.totalSub++;
        if (isVerified) tlStats.ftd.totalVer++;
        tlStats.ftd[matchedProd].sub++;
        if (isVerified) tlStats.ftd[matchedProd].ver++;
      }
    }

    // Filter out TLs where ALL columns are zero (no submissions in both FTD and MTD)
    const filteredTLs = Array.from(tlMetricsMap.values()).filter(
      item => item.mtd.totalSub > 0 || item.ftd.totalSub > 0
    );

    // Sort: Manager name Z-A (descending), then TL name A-Z within each manager group
    const sortedTLs = filteredTLs.sort((a, b) => {
      const mgrCmp = (b.manager || '').toLowerCase().localeCompare((a.manager || '').toLowerCase());
      if (mgrCmp !== 0) return mgrCmp;
      return (a.tlName || '').toLowerCase().localeCompare((b.tlName || '').toLowerCase());
    });

    const grandFTD = createEmptyMetrics();
    const grandMTD = createEmptyMetrics();
    for (const item of sortedTLs) {
      grandFTD.totalSub += item.ftd.totalSub;
      grandFTD.totalVer += item.ftd.totalVer;
      grandMTD.totalSub += item.mtd.totalSub;
      grandMTD.totalVer += item.mtd.totalVer;
      productsList.forEach(p => {
        grandFTD[p].sub += item.ftd[p].sub;
        grandFTD[p].ver += item.ftd[p].ver;
        grandMTD[p].sub += item.mtd[p].sub;
        grandMTD[p].ver += item.mtd[p].ver;
      });
    }

    // 6. Build HTML (clean, no emojis)
    const formatCell = (sub, ver) => {
      if (sub === 0) return `<span style="color:#9e9e9e;font-size:13px;">0 / 0</span>`;
      const verStyle = ver === sub && ver > 0
        ? 'color:#1b5e20;font-weight:700;'
        : ver > 0
          ? 'color:#2e7d32;font-weight:600;'
          : 'color:#c62828;font-weight:600;';
      return `<strong style="font-size:13px;">${sub}</strong>&nbsp;<span style="color:#888;font-size:12px;">/</span>&nbsp;<span style="${verStyle}font-size:13px;">${ver}</span>`;
    };

    // Build HTML rows grouped by manager (manager A-Z, TL A-Z within group)
    const buildRows = (metricKey) => {
      const rows = [];
      let lastManager = null;
      let rowIndex = 0;
      sortedTLs.forEach((tl) => {
        // Manager group header when manager changes
        if (tl.manager !== lastManager) {
          lastManager = tl.manager;
          rows.push(`
            <tr>
              <td colspan="8" style="padding:9px 12px;background:#d7edd7;font-weight:800;font-size:13px;color:#1a4731;letter-spacing:0.4px;border-top:2px solid #a5d6a7;border-bottom:1px solid #c8e6c9;">
                Manager: ${tl.manager}
              </td>
            </tr>`);
          rowIndex = 0; // reset stripe for each manager group
        }
        const m  = tl[metricKey];
        const bg = rowIndex % 2 === 0 ? '#ffffff' : '#f9fbf9';
        rowIndex++;
        rows.push(`
          <tr style="background:${bg};border-bottom:1px solid #e8f0e8;">
            <td style="padding:13px 12px;font-weight:700;font-size:14px;color:#1a4731;border-right:1px solid #e0e8e0;padding-left:22px;">${tl.tlName}</td>
            <td style="padding:13px 12px;font-size:13px;color:#444;border-right:1px solid #e0e8e0;">${tl.manager}</td>
            <td style="padding:13px 12px;text-align:center;background:#f0f7f0;border-right:1px solid #e0e8e0;">${formatCell(m.totalSub, m.totalVer)}</td>
            <td style="padding:13px 12px;text-align:center;border-right:1px solid #e0e8e0;">${formatCell(m['tide'].sub, m['tide'].ver)}</td>
            <td style="padding:13px 12px;text-align:center;border-right:1px solid #e0e8e0;">${formatCell(m['tide insurance'].sub, m['tide insurance'].ver)}</td>
            <td style="padding:13px 12px;text-align:center;border-right:1px solid #e0e8e0;">${formatCell(m['tide msme'].sub, m['tide msme'].ver)}</td>
            <td style="padding:13px 12px;text-align:center;border-right:1px solid #e0e8e0;">${formatCell(m['tide credit card'].sub, m['tide credit card'].ver)}</td>
            <td style="padding:13px 12px;text-align:center;">${formatCell(m['tide bt'].sub, m['tide bt'].ver)}</td>
          </tr>`);
      });
      return rows.join('');
    };

    const buildGrandRow = (grand) => `
      <tr style="background:#e8f5e9;font-weight:700;border-top:2px solid #2e7d32;">
        <td style="padding:15px 12px;font-size:14px;color:#1b5e20;border-right:1px solid #c8e6c9;">OVERALL TOTAL</td>
        <td style="padding:15px 12px;color:#1b5e20;border-right:1px solid #c8e6c9;">—</td>
        <td style="padding:15px 12px;text-align:center;background:#d0ead0;border-right:1px solid #c8e6c9;">${formatCell(grand.totalSub, grand.totalVer)}</td>
        <td style="padding:15px 12px;text-align:center;border-right:1px solid #c8e6c9;">${formatCell(grand['tide'].sub, grand['tide'].ver)}</td>
        <td style="padding:15px 12px;text-align:center;border-right:1px solid #c8e6c9;">${formatCell(grand['tide insurance'].sub, grand['tide insurance'].ver)}</td>
        <td style="padding:15px 12px;text-align:center;border-right:1px solid #c8e6c9;">${formatCell(grand['tide msme'].sub, grand['tide msme'].ver)}</td>
        <td style="padding:15px 12px;text-align:center;border-right:1px solid #c8e6c9;">${formatCell(grand['tide credit card'].sub, grand['tide credit card'].ver)}</td>
        <td style="padding:15px 12px;text-align:center;">${formatCell(grand['tide bt'].sub, grand['tide bt'].ver)}</td>
      </tr>`;

    const thStyle = `padding:13px 12px;font-size:13px;font-weight:700;letter-spacing:0.3px;text-align:center;border-right:1px solid #1b5e20;border-bottom:2px solid #1b5e20;`;
    const thLeft  = thStyle + `text-align:left;`;

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Vegavruddhi Daily TL Report</title>
</head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f0;margin:0;padding:24px;color:#212121;">
  <div style="max-width:1150px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 6px 28px rgba(0,0,0,0.10);overflow:hidden;">

    <!-- HEADER -->
    <div style="background:linear-gradient(135deg,#1b5e20 0%,#2e7d32 100%);padding:30px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td>
          <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">VEGAVRUDDHI</div>
          <div style="font-size:15px;font-weight:600;color:#c8e6c9;margin-top:4px;">Daily TL Verification &amp; Sync Report</div>
          <div style="font-size:12px;color:#a5d6a7;margin-top:6px;">Generated automatically after Google Sheet synchronisation &bull; ${now.toLocaleString()}</div>
        </td>
        <td align="right" valign="top">
          <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:10px 18px;display:inline-block;text-align:center;">
            <div style="font-size:11px;color:#c8e6c9;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Report Date</div>
            <div style="font-size:16px;font-weight:800;color:#ffffff;margin-top:2px;">${now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
          </div>
        </td>
      </tr></table>
    </div>

    <!-- SUMMARY CARDS -->
    <div style="padding:24px 36px 0;display:flex;gap:20px;">
      <table cellpadding="0" cellspacing="0" width="100%"><tr>
        <td width="48%" style="background:#e8f5e9;border:1px solid #c8e6c9;border-radius:10px;padding:18px 22px;vertical-align:top;">
          <div style="font-size:11px;color:#2e7d32;font-weight:700;text-transform:uppercase;letter-spacing:1px;">FTD Performance &mdash; Today</div>
          <div style="font-size:24px;font-weight:800;color:#1b5e20;margin-top:8px;">${grandFTD.totalSub} <span style="font-size:14px;font-weight:400;color:#555;">Submitted</span> &nbsp;/&nbsp; ${grandFTD.totalVer} <span style="font-size:14px;font-weight:400;color:#555;">Verified</span></div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background:#e8f5e9;border:1px solid #c8e6c9;border-radius:10px;padding:18px 22px;vertical-align:top;">
          <div style="font-size:11px;color:#2e7d32;font-weight:700;text-transform:uppercase;letter-spacing:1px;">MTD Performance &mdash; ${currentMonthName}</div>
          <div style="font-size:24px;font-weight:800;color:#1b5e20;margin-top:8px;">${grandMTD.totalSub} <span style="font-size:14px;font-weight:400;color:#555;">Submitted</span> &nbsp;/&nbsp; ${grandMTD.totalVer} <span style="font-size:14px;font-weight:400;color:#555;">Verified</span></div>
        </td>
      </tr></table>
    </div>

    <div style="padding:28px 36px;">

      <!-- FTD TABLE -->
      <div style="margin-bottom:12px;">
        <span style="display:inline-block;background:#1b5e20;color:#ffffff;font-size:13px;font-weight:800;padding:6px 16px;border-radius:6px;letter-spacing:0.5px;">FTD &mdash; For The Day</span>
        <span style="font-size:14px;font-weight:600;color:#444;margin-left:10px;">${now.toLocaleDateString('en-IN', {weekday:'long', day:'2-digit', month:'long', year:'numeric'})}</span>
      </div>
      <div style="overflow-x:auto;margin-bottom:36px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;min-width:800px;">
          <thead>
            <tr style="background:#1b5e20;color:#ffffff;">
              <th style="${thLeft}">Team Leader</th>
              <th style="${thLeft}">Manager</th>
              <th style="${thStyle}">Total<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
              <th style="${thStyle}">Tide<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
              <th style="${thStyle}">Insurance<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
              <th style="${thStyle}">MSME<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
              <th style="${thStyle}">Credit Card<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
              <th style="${thStyle.replace('border-right:1px solid #1b5e20;','')}">Tide BT<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
            </tr>
          </thead>
          <tbody>
            ${buildRows('ftd')}
            ${buildGrandRow(grandFTD)}
          </tbody>
        </table>
      </div>

      <!-- SEPARATOR between FTD and MTD -->
      <div style="margin:44px 0 44px;border-top:2px solid #c8e6c9;"></div>

      <!-- MTD TABLE -->
      <div style="margin-bottom:12px;">
        <span style="display:inline-block;background:#1b5e20;color:#ffffff;font-size:13px;font-weight:800;padding:6px 16px;border-radius:6px;letter-spacing:0.5px;">MTD &mdash; Month To Date</span>
        <span style="font-size:14px;font-weight:600;color:#444;margin-left:10px;">${currentMonthName}</span>
      </div>
      <div style="overflow-x:auto;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;min-width:800px;">
          <thead>
            <tr style="background:#1b5e20;color:#ffffff;">
              <th style="${thLeft}">Team Leader</th>
              <th style="${thLeft}">Manager</th>
              <th style="${thStyle}">Total<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
              <th style="${thStyle}">Tide<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
              <th style="${thStyle}">Insurance<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
              <th style="${thStyle}">MSME<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
              <th style="${thStyle}">Credit Card<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
              <th style="${thStyle.replace('border-right:1px solid #1b5e20;','')}">Tide BT<br><span style="font-weight:400;font-size:11px;">Sub / Ver</span></th>
            </tr>
          </thead>
          <tbody>
            ${buildRows('mtd')}
            ${buildGrandRow(grandMTD)}
          </tbody>
        </table>
      </div>
    </div>

    <!-- FOOTER -->
    <div style="background:#f0f5f0;padding:18px 36px;text-align:center;font-size:12px;color:#666;border-top:1px solid #e0e8e0;">
      Vegavruddhi IT &amp; Business Consultation Services Pvt. Ltd. &mdash; Automated Daily Report<br>
      All figures represent <strong>Submitted / Fully Verified</strong> counts across Team Leader units.
    </div>
  </div>
</body>
</html>`;

    // 7. Generate PDF buffer in-memory (never saved to disk)
    const pdfBuffer = await buildPDFBuffer(
      sortedTLs, grandFTD, grandMTD, productsList, now, currentMonthName
    );
    const pdfFilename = `VV_TL_Report_${now.toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-')}.pdf`;

    // 8. Send mail with PDF attachment
    const smtpUser = (process.env.SMTP_USER || process.env.ADMIN_EMAIL || '').split(',')[0].trim();
    const smtpPass = (process.env.SMTP_PASS || process.env.ADMIN_EMAIL_PASSWORD || '').replace(/\s+/g, '');

    const transporter = nodemailer.createTransport({
      service: process.env.SMTP_SERVICE || 'gmail',
      auth: { user: smtpUser, pass: smtpPass }
    });

    const mailOptions = {
      from    : `"Vegavruddhi Report" <${smtpUser}>`,
      to      : recipients.join(', '),
      subject : `[${currentMonthName} MTD & FTD] Daily TL Verification Report - ${now.toLocaleDateString()}`,
      html    : htmlContent,
      attachments: [{
        filename   : pdfFilename,
        content    : pdfBuffer,
        contentType: 'application/pdf'
      }]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Manager Daily Report email sent successfully! MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId, recipients, totalTLs: sortedTLs.length };

  } catch (error) {
    console.error('Error in sendManagerDailyReport:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { sendManagerDailyReport };
