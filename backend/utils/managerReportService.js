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

function buildPDFBuffer(sortedTLs, grandFTD, grandMTD, productsList, targetDate, now, currentMonthName) {
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

    function drawManagerTotalRow(y, mgrName, mgrTotal) {
      drawRect(MARGIN, y, TOTAL_TW, ROW_H, '#e3f2e3', '#66bb6a');
      const vals = [
        `  Total — ${mgrName}`,
        mgrName,
        fmtCell(mgrTotal.totalSub, mgrTotal.totalVer),
        ...productsList.map(p => fmtCell(mgrTotal[p].sub, mgrTotal[p].ver))
      ];
      let x = MARGIN;
      vals.forEach((v, i) => {
        cellText(v, x, y, COL_W[i], ROW_H, GREEN_DARK, 'Helvetica-Bold', 9, i < 2 ? 'left' : 'center');
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
         .text(`Report Date: ${targetDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}  |  Generated: ${now.toLocaleString()}`, MARGIN, 38, { width: USABLE_W });
      y = 58;

      // ── Summary Cards (side by side)
      const cardW = (USABLE_W - 20) / 2;
      const cardH = 54;
      const cardY = y + 14;

      // Left card — FTD
      drawRect(MARGIN, cardY, cardW, cardH, GREEN_LIGHT, GREEN_BAND);
      doc.fillColor(GREEN_MID).font('Helvetica-Bold').fontSize(10)
         .text(`FTD — ${targetDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, MARGIN + 12, cardY + 10, { width: cardW - 24 });
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

      // Helper to check page break
      const checkPageBreak = (neededH) => {
        if (y + neededH > doc.page.height - MARGIN - 30) {
          doc.addPage();
          y = drawTableHeader(MARGIN, MARGIN);
        }
      };

      // Group sortedTLs by manager
      const managerGroups = new Map();
      sortedTLs.forEach(tl => {
        const mgr = tl.manager || 'Direct';
        if (!managerGroups.has(mgr)) managerGroups.set(mgr, []);
        managerGroups.get(mgr).push(tl);
      });

      // ── Data rows grouped by manager with Total row
      for (const [mgrName, tlsInGroup] of managerGroups.entries()) {
        checkPageBreak(MGR_H);
        y = drawManagerBand(y, mgrName);

        const mgrTotal = { totalSub: 0, totalVer: 0 };
        productsList.forEach(p => { mgrTotal[p] = { sub: 0, ver: 0 }; });

        tlsInGroup.forEach((tl, rowIdx) => {
          const m = tl[metricKey];
          mgrTotal.totalSub += m.totalSub;
          mgrTotal.totalVer += m.totalVer;
          productsList.forEach(p => {
            mgrTotal[p].sub += m[p].sub;
            mgrTotal[p].ver += m[p].ver;
          });

          checkPageBreak(ROW_H);
          y = drawDataRow(y, tl, metricKey, rowIdx);
        });

        checkPageBreak(ROW_H);
        y = drawManagerTotalRow(y, mgrName, mgrTotal);
      }

      // ── Grand total
      checkPageBreak(GRAND_H);
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
      `For the day: ${targetDate.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}`,
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
    // 🛑 Daily email reports paused for a few days as requested by user
    const PAUSED = true;
    if (PAUSED || process.env.PAUSE_DAILY_REPORTS === 'true') {
      console.log('⏸️ Daily Manager FTD & MTD report email is PAUSED for a few days.');
      return { success: true, message: 'Daily Manager FTD/MTD email report is currently paused.' };
    }

    console.log('Starting Manager Daily FTD & MTD Report generation...');

    const emailsStr  = process.env.MANAGER_REPORT_EMAILS || process.env.ADMIN_EMAIL || '';
    const envRecipients = emailsStr.split(',').map(e => e.trim()).filter(Boolean);

    // 1. Date boundaries (T-1 i.e. yesterday's date)
    const now            = new Date();
    const targetDate     = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const startOfDay     = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0);
    const endOfDay       = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);
    const startOfMonth   = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1, 0, 0, 0, 0);
    const currentMonthName = targetDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

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
    const idToTlNameMap     = new Map(); // Maps TL IDs directly to their Name key

    for (const tl of allTLs) {
      const tlName = (tl.name || '').trim();
      if (!tlName) continue;
      
      // Store ID mapping
      if (tl.employeeId) idToTlNameMap.set(String(tl.employeeId), tlName);
      if (tl._id) idToTlNameMap.set(String(tl._id), tlName);

      const memberNames = new Set([tlName.toLowerCase()]);
      for (const emp of allEmployees) {
        const mgrName = (emp.reportingManager || '').trim();
        const empName = (emp.newJoinerName || emp.name || '').trim();
        
        const mgrLower = mgrName.toLowerCase();
        const tlLower = tlName.toLowerCase();
        
        // Match by Exact Name OR Fuzzy Name OR by ID
        const matchedByName = empName && mgrLower && tlLower && (mgrLower === tlLower || mgrLower.includes(tlLower) || tlLower.includes(mgrLower));
        const matchedById = emp.reportingManagerId && (emp.reportingManagerId === tl.employeeId || String(emp.reportingManagerId) === String(tl._id));
        
        if (matchedByName || matchedById) {
          if (empName) {
              memberNames.add(empName.toLowerCase());
              allMemberNamesToTL.set(empName.toLowerCase(), tlName);
          }
          if (emp.employeeId) {
              allMemberNamesToTL.set(String(emp.employeeId), tlName);
          }
          if (emp._id) {
              // NEW: Map the MongoDB ObjectId (submittedBy) directly to the TL
              allMemberNamesToTL.set(String(emp._id), tlName);
          }
        }
      }
      allMemberNamesToTL.set(tlName.toLowerCase(), tlName);
      tlTeamMap.set(tlName, { tl, memberNames });
    }

    // 4. Fetch forms this month up to endOfDay (T-1)
    const formQuery            = { createdAt: { $gte: startOfMonth, $lte: endOfDay } };
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
        email: tl.email || tl.officialEmail || tl.personalEmail || '',
        ftd: createEmptyMetrics(),
        mtd: createEmptyMetrics()
      });
    }

    // 5. Aggregate
    for (const form of allForms) {
      const empName = (form.employeeName || '').trim().toLowerCase();
      const formFor = (form.formFillingFor || '').trim();
      
      const formTlId = form.tlEmployeeId || form.tlId || form.reportingManagerId;
      const formEmpId = form.employeeId || form.fseId || form.submittedBy; // Included submittedBy!

      let targetTLName = null;
      
      // A. Try exact ID match first (Bulletproof Future State)
      if (formTlId && idToTlNameMap.has(String(formTlId))) {
          targetTLName = idToTlNameMap.get(String(formTlId));
      } else if (formEmpId && allMemberNamesToTL.has(String(formEmpId))) {
          targetTLName = allMemberNamesToTL.get(String(formEmpId));
      }
      // B. Try exact Name match (Legacy State)
      else if (formFor && tlMetricsMap.has(formFor)) {
          targetTLName = formFor;
      } else if (empName && allMemberNamesToTL.has(empName)) {
          targetTLName = allMemberNamesToTL.get(empName);
      }
      // C. Try Fuzzy Name match (Rescue Orphaned Data like "Ashwani" vs "Ashwani Kumar")
      else if (formFor || empName) {
         const rawName = formFor || empName;
         const search = rawName.toLowerCase().trim();
         for (const knownTL of tlMetricsMap.keys()) {
            const known = knownTL.toLowerCase().trim();
            if (search.includes(known) || known.includes(search)) {
               targetTLName = knownTL;
               break;
            }
         }
      }

      if (!targetTLName || !tlMetricsMap.has(targetTLName))   continue;

      const tlStats     = tlMetricsMap.get(targetTLName);
      const formDate    = new Date(form.createdAt);
      const isFTD       = formDate >= startOfDay && formDate <= endOfDay;
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

    // Group sortedTLs by manager
    const managerGroups = new Map();
    sortedTLs.forEach(tl => {
      const mgr = tl.manager || 'Direct';
      if (!managerGroups.has(mgr)) managerGroups.set(mgr, []);
      managerGroups.get(mgr).push(tl);
    });

    // Build HTML rows grouped by manager with Total row
    const buildRows = (metricKey) => {
      const rows = [];
      for (const [mgrName, tlsInGroup] of managerGroups.entries()) {
        // Manager group header
        rows.push(`
          <tr>
            <td colspan="8" class="vv-mgr-hdr" style="padding:10px 12px;background:#d7edd7;font-weight:800;font-size:13px;color:#1a4731;letter-spacing:0.4px;border-top:2px solid #a5d6a7;border-bottom:1px solid #c8e6c9;">
              Manager: ${mgrName}
            </td>
          </tr>`);

        const mgrTotal = createEmptyMetrics();
        tlsInGroup.forEach((tl, rowIndex) => {
          const m  = tl[metricKey];
          const bg = rowIndex % 2 === 0 ? '#ffffff' : '#f9fbf9';

          mgrTotal.totalSub += m.totalSub;
          mgrTotal.totalVer += m.totalVer;
          productsList.forEach(p => {
            mgrTotal[p].sub += m[p].sub;
            mgrTotal[p].ver += m[p].ver;
          });

          rows.push(`
            <tr style="background:${bg};border-bottom:1px solid #e8f0e8;">
              <td class="vv-tl-name" style="padding:13px 12px;font-weight:700;font-size:14px;color:#1a4731;border-right:1px solid #e0e8e0;padding-left:22px;">${tl.tlName}</td>
              <td class="vv-mgr-name" style="padding:13px 12px;font-size:13px;color:#444;border-right:1px solid #e0e8e0;">${tl.manager}</td>
              <td class="vv-cell" style="padding:13px 12px;text-align:center;background:#f0f7f0;border-right:1px solid #e0e8e0;">${formatCell(m.totalSub, m.totalVer)}</td>
              <td class="vv-cell" style="padding:13px 12px;text-align:center;border-right:1px solid #e0e8e0;">${formatCell(m['tide'].sub, m['tide'].ver)}</td>
              <td class="vv-cell" style="padding:13px 12px;text-align:center;border-right:1px solid #e0e8e0;">${formatCell(m['tide insurance'].sub, m['tide insurance'].ver)}</td>
              <td class="vv-cell" style="padding:13px 12px;text-align:center;border-right:1px solid #e0e8e0;">${formatCell(m['tide msme'].sub, m['tide msme'].ver)}</td>
              <td class="vv-cell" style="padding:13px 12px;text-align:center;border-right:1px solid #e0e8e0;">${formatCell(m['tide credit card'].sub, m['tide credit card'].ver)}</td>
              <td class="vv-cell" style="padding:13px 12px;text-align:center;">${formatCell(m['tide bt'].sub, m['tide bt'].ver)}</td>
            </tr>`);
        });

        // Manager Total row
        rows.push(`
          <tr style="background:#e3f2e3;font-weight:700;border-top:1.5px solid #81c784;border-bottom:2px solid #66bb6a;">
            <td class="vv-tl-name" style="padding:12px 12px;font-size:13px;color:#1b5e20;border-right:1px solid #c8e6c9;padding-left:14px;">Total &mdash; ${mgrName}</td>
            <td class="vv-mgr-name" style="padding:12px 12px;color:#1b5e20;font-size:13px;border-right:1px solid #c8e6c9;">${mgrName}</td>
            <td class="vv-cell" style="padding:12px 12px;text-align:center;background:#d7edd7;border-right:1px solid #c8e6c9;">${formatCell(mgrTotal.totalSub, mgrTotal.totalVer)}</td>
            <td class="vv-cell" style="padding:12px 12px;text-align:center;border-right:1px solid #c8e6c9;">${formatCell(mgrTotal['tide'].sub, mgrTotal['tide'].ver)}</td>
            <td class="vv-cell" style="padding:12px 12px;text-align:center;border-right:1px solid #c8e6c9;">${formatCell(mgrTotal['tide insurance'].sub, mgrTotal['tide insurance'].ver)}</td>
            <td class="vv-cell" style="padding:12px 12px;text-align:center;border-right:1px solid #c8e6c9;">${formatCell(mgrTotal['tide msme'].sub, mgrTotal['tide msme'].ver)}</td>
            <td class="vv-cell" style="padding:12px 12px;text-align:center;border-right:1px solid #c8e6c9;">${formatCell(mgrTotal['tide credit card'].sub, mgrTotal['tide credit card'].ver)}</td>
            <td class="vv-cell" style="padding:12px 12px;text-align:center;">${formatCell(mgrTotal['tide bt'].sub, mgrTotal['tide bt'].ver)}</td>
          </tr>`);
      }
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
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Vegavruddhi Daily TL Report</title>
  <style>
    /* Force light mode — prevent Gmail dark mode from inverting colours */
    :root { color-scheme: light !important; }
    body { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    /* Dark mode override: keep header white text visible */
    @media (prefers-color-scheme: dark) {
      .vv-header { background-color: #1b5e20 !important; }
      .vv-header * { color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; }
      .vv-header .vv-sub { color: #c8e6c9 !important; -webkit-text-fill-color: #c8e6c9 !important; }
      .vv-header .vv-meta { color: #a5d6a7 !important; -webkit-text-fill-color: #a5d6a7 !important; }
      .vv-body-wrap { background-color: #ffffff !important; }
    }
    /* Mobile font size and responsive table enforcement */
    @media only screen and (max-width: 650px) {
      .vv-body-wrap { padding: 8px !important; }
      .vv-header { padding: 18px 16px !important; }
      .vv-hdr-title { font-size: 19px !important; }
      .vv-hdr-sub { font-size: 13px !important; }
      .vv-hdr-meta { font-size: 11px !important; }
      .vv-table-wrap { overflow-x: auto !important; -webkit-overflow-scrolling: touch !important; width: 100% !important; display: block !important; max-width: 100% !important; border: 1px solid #c8e6c9 !important; border-radius: 8px !important; }
      .vv-table { min-width: 620px !important; width: 100% !important; }
      .vv-table th { padding: 8px 6px !important; font-size: 11px !important; }
      .vv-tl-name { font-size: 12.5px !important; padding: 10px 8px !important; padding-left: 10px !important; }
      .vv-mgr-name { font-size: 11.5px !important; padding: 10px 6px !important; }
      .vv-cell { font-size: 11.5px !important; padding: 10px 6px !important; }
      .vv-mgr-hdr { font-size: 12px !important; padding: 8px 8px !important; }
    }
  </style>
</head>
<body class="vv-body-wrap" style="font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f0;margin:0;padding:16px;color:#212121;font-size:16px;">
  <!-- Hidden preheader: unique token prevents Gmail from collapsing this email as quoted content -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    Vegavruddhi Daily Report &bull; ${now.toISOString()} &bull; Ref:${Math.random().toString(36).slice(2,10).toUpperCase()}
    &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
    &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
  </div>
  <div style="max-width:1150px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 6px 28px rgba(0,0,0,0.10);overflow:hidden;">

    <!-- HEADER -->
    <div class="vv-header" style="background-color:#1b5e20;background:linear-gradient(135deg,#1b5e20 0%,#2e7d32 100%);padding:28px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td>
          <div class="vv-hdr-title" style="font-size:22px;font-weight:800;color:#ffffff !important;-webkit-text-fill-color:#ffffff;letter-spacing:0.5px;">VEGAVRUDDHI</div>
          <div class="vv-hdr-sub vv-sub" style="font-size:15px;font-weight:600;color:#c8e6c9 !important;-webkit-text-fill-color:#c8e6c9;margin-top:4px;">Daily TL Verification &amp; Sync Report</div>
          <div class="vv-hdr-meta vv-meta" style="font-size:12px;color:#a5d6a7 !important;-webkit-text-fill-color:#a5d6a7;margin-top:6px;">Generated automatically after Google Sheet synchronisation &bull; ${now.toLocaleString()}</div>
        </td>
        <td align="right" valign="top">
          <div style="background:rgba(255,255,255,0.18);border-radius:8px;padding:10px 16px;display:inline-block;text-align:center;">
            <div style="font-size:11px;color:#c8e6c9 !important;-webkit-text-fill-color:#c8e6c9;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Report Date</div>
            <div style="font-size:16px;font-weight:800;color:#ffffff !important;-webkit-text-fill-color:#ffffff;margin-top:2px;">${targetDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
          </div>
        </td>
      </tr></table>
    </div>

    <!-- SUMMARY CARDS -->
    <div style="padding:24px 36px 0;display:flex;gap:20px;">
      <table cellpadding="0" cellspacing="0" width="100%"><tr>
        <td width="48%" style="background:#e8f5e9;border:1px solid #c8e6c9;border-radius:10px;padding:18px 22px;vertical-align:top;">
          <div style="font-size:11px;color:#2e7d32;font-weight:700;text-transform:uppercase;letter-spacing:1px;">FTD Performance &mdash; ${targetDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
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
        <span style="font-size:14px;font-weight:600;color:#444;margin-left:10px;">${targetDate.toLocaleDateString('en-IN', {weekday:'long', day:'2-digit', month:'long', year:'numeric'})}</span>
      </div>
      <!-- Anti-clipping token for FTD -->
      <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">FTD_Summary_${now.getTime()} &zwnj;&nbsp;&zwnj;&nbsp;</div>
      <div class="vv-table-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;display:block;max-width:100%;width:100%;margin-bottom:36px;border:1px solid #c8e6c9;border-radius:8px;">
        <table class="vv-table" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;min-width:620px;width:100%;">
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
      <!-- Anti-clipping token for MTD -->
      <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">MTD_Summary_${now.getTime()}_${Math.random()} &zwnj;&nbsp;&zwnj;&nbsp;</div>
      <div class="vv-table-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;display:block;max-width:100%;width:100%;border:1px solid #c8e6c9;border-radius:8px;">
        <table class="vv-table" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;min-width:620px;width:100%;">
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
      sortedTLs, grandFTD, grandMTD, productsList, targetDate, now, currentMonthName
    );
    const pdfFilename = `VV_TL_Report_${targetDate.toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-')}.pdf`;

    // 8. Send mail with PDF attachment
    const smtpUser = (process.env.SMTP_USER || process.env.ADMIN_EMAIL || '').split(',')[0].trim();
    const smtpPass = (process.env.SMTP_PASS || process.env.ADMIN_EMAIL_PASSWORD || '').replace(/\s+/g, '');

    const transporter = nodemailer.createTransport({
      service: process.env.SMTP_SERVICE || 'gmail',
      auth: { user: smtpUser, pass: smtpPass }
    });

    // Combine .env recipients with dynamic TL emails from active report records
    const tlEmails = sortedTLs
      .map(t => (t.email || '').trim())
      .filter(e => e && e.includes('@'));
    const finalRecipients = Array.from(new Set([...envRecipients, ...tlEmails]));

    if (finalRecipients.length === 0) {
      console.warn('No recipient emails found (neither in .env nor in active TL records). Skipping report.');
      return { success: false, reason: 'No recipient emails found' };
    }

    const mailOptions = {
      from    : `"Vegavruddhi Report" <${smtpUser}>`,
      to      : finalRecipients.join(', '),
      subject : `[${currentMonthName} MTD & FTD] Daily TL Verification Report (${targetDate.toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'})}) • ${now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false})}`,
      html    : htmlContent,
      attachments: [{
        filename   : pdfFilename,
        content    : pdfBuffer,
        contentType: 'application/pdf'
      }]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Manager Daily Report email sent successfully to ${finalRecipients.length} recipients! MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId, recipients: finalRecipients, totalTLs: sortedTLs.length };

  } catch (error) {
    console.error('Error in sendManagerDailyReport:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { sendManagerDailyReport };
