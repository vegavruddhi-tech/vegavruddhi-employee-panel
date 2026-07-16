const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const FormResponse = require('../models/FormResponse');
const TLFormResponse = require('../models/TLFormResponse');
const TeamLead = require('../models/TeamLead');
const Employee = require('../models/Employee');

/**
 * Normalize product names to match exact categories
 */
function normalizeProduct(product) {
  if (!product || product === 'undefined' || product === 'null') return 'tide';
  let val = String(product).toLowerCase().trim();
  if (val === 'msme') val = 'tide msme';
  if (val === 'insurance') val = 'tide insurance';
  if (val === 'bt') val = 'tide bt';
  if (val === 'credit card' || val === 'cc') val = 'tide credit card';
  if (!val) return 'tide';
  return val;
}

/**
 * Get product category for a form
 */
function getProductCategory(form) {
  const raw = form.formFillingFor || 
              form.tideProduct || 
              form.brand || 
              (Array.isArray(form.attemptedProducts) && form.attemptedProducts.length > 0 ? form.attemptedProducts[0] : '') ||
              'tide';
  return normalizeProduct(raw);
}

/**
 * Main function to aggregate data and send the FTD and MTD verification report to Managers
 */
async function sendManagerDailyReport() {
  try {
    console.log('📬 Starting Manager Daily FTD & MTD Report generation...');

    const emailsStr = process.env.MANAGER_REPORT_EMAILS || process.env.ADMIN_EMAIL || '';
    const recipients = emailsStr.split(',').map(e => e.trim()).filter(Boolean);

    if (recipients.length === 0) {
      console.warn('⚠️ No MANAGER_REPORT_EMAILS or ADMIN_EMAIL configured in .env. Skipping report.');
      return { success: false, reason: 'No recipient emails configured' };
    }

    // 1. Determine date boundaries
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const currentMonthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    // 2. Fetch all Team Leaders & Employees (FSEs)
    const [allTLs, allEmployees] = await Promise.all([
      TeamLead.find({ approvalStatus: { $ne: 'rejected' } }).lean(),
      Employee.find({ approvalStatus: { $ne: 'rejected' } }).lean()
    ]);

    if (!allTLs || allTLs.length === 0) {
      console.warn('⚠️ No Team Leaders found in database.');
      return { success: false, reason: 'No Team Leaders found' };
    }

    // Map each TL to their team member names (TL name itself + reporting FSE names)
    const tlTeamMap = new Map(); // tlName -> { tlObj, memberNames: Set<string> }
    const allMemberNamesToTL = new Map(); // employeeName -> tlName

    for (const tl of allTLs) {
      const tlName = (tl.name || '').trim();
      if (!tlName) continue;

      const memberNames = new Set([tlName.toLowerCase()]);
      
      // Find all employees reporting to this TL
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

    // 3. Fetch all forms submitted this month (MTD includes FTD)
    const formQuery = { createdAt: { $gte: startOfMonth } };
    const [fseForms, tlForms] = await Promise.all([
      FormResponse.find(formQuery).lean(),
      TLFormResponse.find(formQuery).lean()
    ]);

    const allForms = [...fseForms, ...tlForms];

    // Initialize metrics per TL for FTD and MTD
    const productsList = ['tide', 'tide insurance', 'tide msme', 'tide credit card', 'tide bt'];
    const createEmptyMetrics = () => {
      const obj = { totalSub: 0, totalVer: 0 };
      productsList.forEach(p => { obj[p] = { sub: 0, ver: 0 }; });
      return obj;
    };

    const tlMetricsMap = new Map(); // tlName -> { ftd: metrics, mtd: metrics, manager: string }
    for (const [tlName, { tl }] of tlTeamMap.entries()) {
      tlMetricsMap.set(tlName, {
        tlName,
        manager: tl.reportingManager || 'Direct',
        ftd: createEmptyMetrics(),
        mtd: createEmptyMetrics()
      });
    }

    // 4. Process all forms and assign to respective Team Leader
    for (const form of allForms) {
      const empName = (form.employeeName || '').trim().toLowerCase();
      const formFor = (form.formFillingFor || '').trim();
      
      // Match to TL
      let targetTLName = null;
      if (formFor && tlMetricsMap.has(formFor)) {
        targetTLName = formFor;
      } else if (empName && allMemberNamesToTL.has(empName)) {
        targetTLName = allMemberNamesToTL.get(empName);
      }

      if (!targetTLName || !tlMetricsMap.has(targetTLName)) continue;

      const tlStats = tlMetricsMap.get(targetTLName);
      const isFTD = new Date(form.createdAt) >= startOfDay;
      const isVerified = form.verificationStatus === 'Fully Verified';
      const prod = getProductCategory(form);
      const matchedProd = productsList.includes(prod) ? prod : 'tide';

      // Update MTD
      tlStats.mtd.totalSub++;
      if (isVerified) tlStats.mtd.totalVer++;
      tlStats.mtd[matchedProd].sub++;
      if (isVerified) tlStats.mtd[matchedProd].ver++;

      // Update FTD if submitted today
      if (isFTD) {
        tlStats.ftd.totalSub++;
        if (isVerified) tlStats.ftd.totalVer++;
        tlStats.ftd[matchedProd].sub++;
        if (isVerified) tlStats.ftd[matchedProd].ver++;
      }
    }

    // Sort TLs by MTD Total Submitted descending
    const sortedTLs = Array.from(tlMetricsMap.values()).sort((a, b) => b.mtd.totalSub - a.mtd.totalSub);

    // Calculate grand totals
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

    // 5. Build HTML Table Template
    const formatCell = (sub, ver) => {
      if (sub === 0) return `<span style="color: #bbb;">0 / 0</span>`;
      const verStyle = ver === sub && ver > 0 ? 'color: #1b5e20; font-weight: bold;' : ver > 0 ? 'color: #2e7d32; font-weight: bold;' : 'color: #d32f2f;';
      return `<strong>${sub}</strong> / <span style="${verStyle}">${ver}</span>`;
    };

    const buildRows = (metricKey) => {
      return sortedTLs.map((tl, index) => {
        const m = tl[metricKey];
        const bg = index % 2 === 0 ? '#ffffff' : '#f9fbf9';
        return `
          <tr style="background-color: ${bg}; border-bottom: 1px solid #e0e0e0;">
            <td style="padding: 12px 10px; font-weight: 600; color: #1a4731;">${tl.tlName}</td>
            <td style="padding: 12px 10px; color: #555;">${tl.manager}</td>
            <td style="padding: 12px 10px; text-align: center; background: #f0f7f0;">${formatCell(m.totalSub, m.totalVer)}</td>
            <td style="padding: 12px 10px; text-align: center;">${formatCell(m['tide'].sub, m['tide'].ver)}</td>
            <td style="padding: 12px 10px; text-align: center;">${formatCell(m['tide insurance'].sub, m['tide insurance'].ver)}</td>
            <td style="padding: 12px 10px; text-align: center;">${formatCell(m['tide msme'].sub, m['tide msme'].ver)}</td>
            <td style="padding: 12px 10px; text-align: center;">${formatCell(m['tide credit card'].sub, m['tide credit card'].ver)}</td>
            <td style="padding: 12px 10px; text-align: center;">${formatCell(m['tide bt'].sub, m['tide bt'].ver)}</td>
          </tr>
        `;
      }).join('');
    };

    const buildGrandRow = (grand) => `
      <tr style="background-color: #e8f5e9; font-weight: bold; border-top: 2px solid #2e7d32;">
        <td style="padding: 14px 10px; color: #1b5e20;">OVERALL TOTAL</td>
        <td style="padding: 14px 10px; color: #1b5e20;">—</td>
        <td style="padding: 14px 10px; text-align: center; color: #1b5e20;">${formatCell(grand.totalSub, grand.totalVer)}</td>
        <td style="padding: 14px 10px; text-align: center;">${formatCell(grand['tide'].sub, grand['tide'].ver)}</td>
        <td style="padding: 14px 10px; text-align: center;">${formatCell(grand['tide insurance'].sub, grand['tide insurance'].ver)}</td>
        <td style="padding: 14px 10px; text-align: center;">${formatCell(grand['tide msme'].sub, grand['tide msme'].ver)}</td>
        <td style="padding: 14px 10px; text-align: center;">${formatCell(grand['tide credit card'].sub, grand['tide credit card'].ver)}</td>
        <td style="padding: 14px 10px; text-align: center;">${formatCell(grand['tide bt'].sub, grand['tide bt'].ver)}</td>
      </tr>
    `;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f4; margin: 0; padding: 20px; color: #333; }
          .container { max-width: 1100px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); overflow: hidden; }
          .header { background: linear-gradient(135px, #1b5e20, #2e7d32); color: #ffffff; padding: 25px 30px; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
          .header p { margin: 6px 0 0; font-size: 14px; opacity: 0.9; }
          .content { padding: 30px; }
          .summary-cards { display: flex; gap: 20px; margin-bottom: 30px; }
          .card { flex: 1; background: #f9fbf9; border: 1px solid #e0ebe0; border-radius: 10px; padding: 18px 22px; }
          .card h3 { margin: 0 0 8px; color: #1a4731; font-size: 15px; }
          .card .val { font-size: 22px; font-weight: 700; color: #2e7d32; }
          .section-title { font-size: 18px; font-weight: 700; color: #1a4731; margin: 30px 0 14px; display: flex; align-items: center; gap: 8px; border-bottom: 2px solid #e0ebe0; padding-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 35px; font-size: 13px; }
          th { background-color: #f0f5f0; color: #1a4731; font-weight: 700; padding: 12px 10px; text-align: center; border-bottom: 2px solid #ccdccc; }
          th.left { text-align: left; }
          .footer { background: #f0f5f0; padding: 20px; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📊 Vegavruddhi Daily TL Verification & Sync Report</h1>
            <p>Generated automatically following Google Sheet synchronization • ${now.toLocaleString()}</p>
          </div>
          
          <div class="content">
            <div class="summary-cards">
              <div class="card">
                <h3>📌 FTD Performance (Today)</h3>
                <div class="val">${grandFTD.totalSub} Submitted / ${grandFTD.totalVer} Verified</div>
              </div>
              <div class="card">
                <h3>📅 MTD Performance (${currentMonthName})</h3>
                <div class="val">${grandMTD.totalSub} Submitted / ${grandMTD.totalVer} Verified</div>
              </div>
            </div>

            <!-- FTD SECTION -->
            <div class="section-title">⚡ FTD (For The Day) Summary by Team Leader — Today (${now.toLocaleDateString()})</div>
            <table>
              <thead>
                <tr>
                  <th class="left">Team Leader</th>
                  <th class="left">Manager</th>
                  <th>Total (Sub/Ver)</th>
                  <th>Tide (Sub/Ver)</th>
                  <th>Insurance (Sub/Ver)</th>
                  <th>MSME (Sub/Ver)</th>
                  <th>Credit Card (Sub/Ver)</th>
                  <th>Tide BT (Sub/Ver)</th>
                </tr>
              </thead>
              <tbody>
                ${buildRows('ftd')}
                ${buildGrandRow(grandFTD)}
              </tbody>
            </table>

            <!-- MTD SECTION -->
            <div class="section-title">📅 MTD Month-To-Date Summary by Team Leader — ${currentMonthName}</div>
            <table>
              <thead>
                <tr>
                  <th class="left">Team Leader</th>
                  <th class="left">Manager</th>
                  <th>Total (Sub/Ver)</th>
                  <th>Tide (Sub/Ver)</th>
                  <th>Insurance (Sub/Ver)</th>
                  <th>MSME (Sub/Ver)</th>
                  <th>Credit Card (Sub/Ver)</th>
                  <th>Tide BT (Sub/Ver)</th>
                </tr>
              </thead>
              <tbody>
                ${buildRows('mtd')}
                ${buildGrandRow(grandMTD)}
              </tbody>
            </table>
          </div>

          <div class="footer">
            Vegavruddhi IT & Business Consultation Services Pvt. Ltd. — Automated Daily Report<br>
            Note: All figures represent Submitted / Fully Verified counts across Team Leader units.
          </div>
        </div>
      </body>
      </html>
    `;

    const smtpUser = (process.env.SMTP_USER || process.env.ADMIN_EMAIL || '').split(',')[0].trim();
    const smtpPass = (process.env.SMTP_PASS || process.env.ADMIN_EMAIL_PASSWORD || '').replace(/\s+/g, '');

    // 6. Setup Nodemailer Transporter
    const transporter = nodemailer.createTransport({
      service: process.env.SMTP_SERVICE || 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    const mailOptions = {
      from: `"Vegavruddhi Report" <${smtpUser}>`,
      to: recipients.join(', '),
      subject: `📊 [${currentMonthName} MTD & FTD] Daily TL Verification Report - ${now.toLocaleDateString()}`,
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Manager Daily Report email sent successfully! MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId, recipients, totalTLs: sortedTLs.length };

  } catch (error) {
    console.error('❌ Error in sendManagerDailyReport:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendManagerDailyReport
};
