const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Logo base64 - loaded once at startup
let LOGO_BASE64 = null;
function getLogoBase64() {
  if (LOGO_BASE64) return LOGO_BASE64;
  try {
    // The file is actually a PNG despite the .svg extension
    const logoPath = path.join(__dirname, '../../../vegavruddhi-admin-panel/fse-dashboard/public/vegavruddhi-logo.svg');
    if (fs.existsSync(logoPath)) {
      LOGO_BASE64 = fs.readFileSync(logoPath).toString('base64');
      console.log('✅ Logo loaded, size:', LOGO_BASE64.length);
    } else {
      console.warn('⚠️ Logo not found at:', logoPath);
    }
  } catch (e) {
    console.warn('⚠️ Logo load error:', e.message);
  }
  return LOGO_BASE64;
}

// Pre-load logo on module init
getLogoBase64();

/**
 * Get total calendar days in a month (including Sundays)
 */
function getWorkingDaysInMonth(month, year) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const monthIndex = months.indexOf(month);
  if (monthIndex === -1) return 30;
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Calculate salary breakdown
 * - If pointsSalary > 25000: breakdown based on ₹25,000 + incentive shown separately
 * - If pointsSalary <= 25000: breakdown based on actual earned salary
 */
function calculateSalaryBreakdown(slip) {
  const FIXED_GROSS  = 25000;
  const TOTAL_DAYS   = getWorkingDaysInMonth(slip.month, slip.year);
  const totalPts     = (slip.totalPoints || 0) > 0 ? slip.totalPoints : (slip.pointsEarned || 0);
  const pointsSalary = totalPts * (slip.pointValue || 250);
  const hasIncentive = pointsSalary > FIXED_GROSS;
  const incentive    = hasIncentive ? Math.round((pointsSalary - FIXED_GROSS) * 10) / 10 : 0;
  const workingDays  = hasIncentive ? TOTAL_DAYS : Math.round((pointsSalary / FIXED_GROSS) * TOTAL_DAYS);

  const pctBasic = slip.pctBasic || 50;
  const pctHRA   = slip.pctHRA   || 25;
  const pctConv  = slip.pctConv  || 5;
  const pctSpec  = slip.pctSpec  || 20;

  // Base: ₹25,000 if incentive applies, else actual salary
  const base             = hasIncentive ? FIXED_GROSS : pointsSalary;
  const basic            = Math.round(base * pctBasic / 100);
  const hra              = Math.round(base * pctHRA   / 100);
  const conveyance       = Math.round(base * pctConv  / 100);
  const specialAllowance = Math.round(base * pctSpec  / 100);

  const employeePF      = slip.deductionPF   || 0;
  const professionalTax = slip.deductionPT   || 0;
  const esic            = slip.deductionESIC || 0;
  const tds             = slip.deductionTDS  || 0;
  const totalDeductions = employeePF + professionalTax + esic + tds;

  const grossSalary = pointsSalary;
  const netSalary   = grossSalary - totalDeductions;

  return {
    FIXED_GROSS, basic, hra, conveyance, specialAllowance,
    pctBasic, pctHRA, pctConv, pctSpec,
    pointsSalary, incentive, hasIncentive, workingDays,
    TOTAL_DAYS, employeePF, professionalTax, esic, tds,
    totalDeductions, grossSalary, netSalary
  };
}

/**
 * Generate Salary Slip PDF - returns Buffer
 * @param {Object} slipData - Salary slip data
 * @param {boolean} isAdmin - Show % column if true (admin view)
 */
async function generateSalarySlipPDF(slipData, isAdmin = false) {
  let browser;
  try {
    if (!slipData || !slipData.employeeName || !slipData.month || !slipData.year) {
      throw new Error('Invalid slip data: missing required fields');
    }
    console.log(`📄 Generating PDF for ${slipData.employeeName} (${slipData.month} ${slipData.year})...`);

    // Auto-detect Chrome path based on OS
    const chromePaths = [
      '/usr/bin/google-chrome',           // AWS Linux (Google Chrome)
      '/usr/bin/chromium-browser',        // AWS Linux (Chromium)
      '/usr/bin/chromium',                // AWS Linux (Chromium alt)
      '/usr/bin/google-chrome-stable',    // AWS Linux (stable)
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS local
    ];
    const executablePath = chromePaths.find(p => {
      try { return require('fs').existsSync(p); } catch (e) { return false; }
    });

    browser = await puppeteer.launch({
      executablePath: executablePath || undefined, // undefined = use puppeteer's bundled Chrome
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const page = await browser.newPage();
    const html = generateSalarySlipHTML(slipData, isAdmin);
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
    });

    await browser.close();
    browser = null;
    console.log(`✅ PDF generated, size: ${pdfBuffer.length} bytes`);
    return pdfBuffer;

  } catch (error) {
    console.error('❌ PDF generation error:', error.message);
    if (browser) try { await browser.close(); } catch (e) {}
    throw new Error(`PDF generation failed: ${error.message}`);
  }
}

/**
 * Generate HTML template for salary slip
 */
function generateSalarySlipHTML(slip, isAdmin = false) {
  const calc = calculateSalaryBreakdown(slip);
  const fmt  = (n) => Number(n || 0).toLocaleString('en-IN');

  const generatedDate = new Date(slip.generatedAt || Date.now()).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const logoB64 = getLogoBase64();
  // The file is PNG despite .svg extension
  const logoSrc = logoB64 ? `data:image/png;base64,${logoB64}` : null;

  const earningsRows = [
    { label: 'Basic',             pct: calc.pctBasic, amt: calc.basic },
    { label: 'HRA',               pct: calc.pctHRA,   amt: calc.hra },
    { label: 'Conveyance / Fuel', pct: calc.pctConv,  amt: calc.conveyance },
    { label: 'Special Allowance', pct: calc.pctSpec,  amt: calc.specialAllowance },
  ];

  const earningsHTML = earningsRows.map(r => `
    <tr>
      <td>${r.label}</td>
      ${isAdmin ? `<td class="center">${r.pct}%</td>` : ''}
      <td class="right">₹${fmt(r.amt)}</td>
    </tr>`).join('');

  const incentiveHTML = calc.hasIncentive ? `
    <tr class="incentive">
      <td>Incentive <span class="note">(₹${fmt(calc.pointsSalary)} − ₹${fmt(calc.FIXED_GROSS)})</span></td>
      ${isAdmin ? `<td class="center">Variable</td>` : ''}
      <td class="right">₹${fmt(calc.incentive)}</td>
    </tr>` : '';

  const deductionItems = [
    { label: 'Employee PF',          val: calc.employeePF },
    { label: 'Professional Tax',     val: calc.professionalTax },
    { label: 'ESIC (if applicable)', val: calc.esic },
    { label: 'TDS (as applicable)',  val: calc.tds },
  ];

  const deductionsHTML = deductionItems.map(d => `
    <tr>
      <td style="color:#333">${d.label}</td>
      <td class="right" style="color:${d.val > 0 ? '#333' : '#bbb'};font-style:${d.val > 0 ? 'normal' : 'italic'}">
        ${d.val > 0 ? `₹${fmt(d.val)}` : '—'}
      </td>
    </tr>`).join('');

  const slabRow = (slip.slabPoints || 0) > 0
    ? `<div class="info-row"><span class="lbl">Slab Bonus:</span><span class="val" style="color:#e65100;font-weight:700">+${slip.slabPoints} pts</span></div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; }
  body { font-family: Arial, sans-serif; font-size: 13px; background:#fff; padding:28px 36px; }

  /* Header */
  .header { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid #1a5c38; padding-bottom:14px; margin-bottom:18px; }
  .logo { height:56px; object-fit:contain; }
  .logo-text { font-size:28px; font-weight:900; color:#1a5c38; }
  .header-right { text-align:right; }
  .slip-title { font-size:22px; font-weight:900; color:#1a5c38; }
  .slip-sub { font-size:12px; color:#666; margin-top:3px; }

  /* Info grid */
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; background:#f5f9f6; padding:14px 18px; border-radius:6px; margin-bottom:18px; border:1px solid #d4e8da; }
  .info-row { display:flex; gap:6px; }
  .lbl { font-weight:700; color:#1a5c38; min-width:110px; font-size:12px; }
  .val { color:#222; font-size:12px; }

  /* Section title */
  .sec { font-size:14px; font-weight:800; color:#1a5c38; border-bottom:2px solid #1a5c38; padding-bottom:5px; margin:18px 0 8px; letter-spacing:0.3px; }

  /* Tables */
  table { width:100%; border-collapse:collapse; margin-bottom:8px; font-size:13px; }
  th { background:#1a5c38; color:#fff; padding:9px 12px; text-align:left; font-weight:700; font-size:12px; }
  td { padding:8px 12px; border-bottom:1px solid #eee; }
  tr:last-child td { border-bottom:none; }
  .center { text-align:center; color:#555; }
  .right { text-align:right; font-weight:600; }
  .subtotal td { font-weight:800; background:#f0f7f2; border-top:2px solid #1a5c38 !important; font-size:14px; }
  .incentive td { color:#e65100; font-weight:700; }
  .note { font-size:10px; font-weight:400; }
  tr:nth-child(even) { background:#fafafa; }
  .subtotal { background:#f0f7f2 !important; }

  /* Net salary */
  .net { background:#1a5c38; color:#fff; padding:18px 24px; border-radius:6px; display:flex; justify-content:space-between; align-items:center; margin:20px 0 16px; }
  .net-lbl { font-size:16px; font-weight:700; }
  .net-amt { font-size:24px; font-weight:900; }

  /* Footer */
  .footer { margin-top:20px; border-top:1px solid #ddd; padding-top:10px; text-align:center; color:#aaa; font-size:10px; }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  ${logoSrc
    ? `<img src="${logoSrc}" class="logo" alt="Vegavruddhi" />`
    : `<div class="logo-text">VEGAVRUDDHI</div>`
  }
  <div class="header-right">
    <div class="slip-title">Salary Slip</div>
    <div class="slip-sub">${slip.month} ${slip.year}</div>
    <div class="slip-sub">Generated: ${generatedDate}</div>
  </div>
</div>

<!-- Employee Info -->
<div class="info-grid">
  <div class="info-row"><span class="lbl">Employee Name:</span><span class="val">${slip.employeeName}</span></div>
  <div class="info-row"><span class="lbl">Employee ID:</span><span class="val">${slip.employeeId || 'N/A'}</span></div>
  <div class="info-row"><span class="lbl">Department:</span><span class="val">Sales</span></div>
  <div class="info-row"><span class="lbl">Designation:</span><span class="val">${slip.role || 'FSE'}</span></div>
  <div class="info-row"><span class="lbl">Month:</span><span class="val">${slip.month} ${slip.year}</span></div>
  <div class="info-row"><span class="lbl">Working Days:</span><span class="val">${calc.workingDays}</span></div>
  <div class="info-row"><span class="lbl">Base Points:</span><span class="val">${slip.pointsEarned || 0} pts</span></div>
  ${slabRow}
  <div class="info-row"><span class="lbl">Total Points:</span><span class="val" style="font-weight:700;color:#1a5c38">${slip.totalPoints || slip.pointsEarned || 0} pts × ₹${slip.pointValue || 250} = ₹${fmt(calc.pointsSalary)}</span></div>
</div>

<!-- Earnings -->
<div class="sec">Earnings</div>
<table>
  <thead>
    <tr>
      <th>Component</th>
      ${isAdmin ? '<th class="center" style="color:#fff">%</th>' : ''}
      <th style="text-align:right;color:#fff">Amount (₹)</th>
    </tr>
  </thead>
  <tbody>
    ${earningsHTML}
    ${incentiveHTML}
    <tr class="subtotal">
      <td colspan="${isAdmin ? 2 : 1}">Gross Salary</td>
      <td class="right">₹${fmt(calc.grossSalary)}</td>
    </tr>
  </tbody>
</table>

<!-- Deductions -->
<div class="sec">Deductions</div>
<table>
  <thead>
    <tr>
      <th>Component</th>
      <th style="text-align:right;color:#fff">Amount (₹)</th>
    </tr>
  </thead>
  <tbody>
    ${deductionsHTML}
    <tr class="subtotal">
      <td>Total Deductions</td>
      <td class="right">₹${fmt(calc.totalDeductions)}</td>
    </tr>
  </tbody>
</table>

<!-- Net Salary -->
<div class="net">
  <span class="net-lbl">Net Salary (Take Home)</span>
  <span class="net-amt">₹${fmt(calc.netSalary)}</span>
</div>

${slip.remarks ? `<div style="background:#fff8e1;padding:10px 14px;border-left:4px solid #ffc107;margin:10px 0;font-size:12px;color:#555;border-radius:4px"><strong>Remarks:</strong> ${slip.remarks}</div>` : ''}

<!-- Footer -->
<div class="footer">
  This is a computer-generated document. No signature required. &nbsp;|&nbsp; © ${new Date().getFullYear()} Vegavruddhi Pvt. Ltd.
</div>

</body>
</html>`;
}

module.exports = { generateSalarySlipPDF, generatePDFBuffer: generateSalarySlipPDF, generateSalarySlipHTML, calculateSalaryBreakdown };
