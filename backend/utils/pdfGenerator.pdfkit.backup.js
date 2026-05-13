const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Logo base64 - loaded once at startup
let LOGO_BASE64 = null;
let LOGO_BUFFER = null;

function getLogoBuffer() {
  if (LOGO_BUFFER) return LOGO_BUFFER;
  try {
    // Try multiple possible logo paths
    const logoPaths = [
      path.join(__dirname, '../../../vegavruddhi-admin-panel/fse-dashboard/public/vegavruddhi-logo.svg'),
      path.join(__dirname, '../../employee-app/public/vegavruddhi-logo.svg'),
      path.join(__dirname, '../public/vegavruddhi-logo.svg'),
    ];
    
    for (const logoPath of logoPaths) {
      if (fs.existsSync(logoPath)) {
        LOGO_BUFFER = fs.readFileSync(logoPath);
        console.log('✅ Logo loaded from:', logoPath, 'size:', LOGO_BUFFER.length);
        break;
      }
    }
    
    if (!LOGO_BUFFER) {
      console.warn('⚠️ Logo not found in any path');
    }
  } catch (e) {
    console.warn('⚠️ Logo load error:', e.message);
  }
  return LOGO_BUFFER;
}

// Pre-load logo on module init
getLogoBuffer();

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
 * Generate Salary Slip PDF using PDFKit - returns Buffer
 * @param {Object} slipData - Salary slip data
 * @param {boolean} isAdmin - Show % column if true (admin view)
 */
async function generateSalarySlipPDF(slipData, isAdmin = false) {
  return new Promise((resolve, reject) => {
    try {
      if (!slipData || !slipData.employeeName || !slipData.month || !slipData.year) {
        throw new Error('Invalid slip data: missing required fields');
      }
      console.log(`📄 Generating PDF for ${slipData.employeeName} (${slipData.month} ${slipData.year})...`);

      const calc = calculateSalaryBreakdown(slipData);
      const fmt = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

      const generatedDate = new Date(slipData.generatedAt || Date.now()).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

      // Create PDF document
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 50, right: 50 }
      });

      // Collect PDF data in buffer
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        console.log(`✅ PDF generated, size: ${pdfBuffer.length} bytes`);
        resolve(pdfBuffer);
      });
      doc.on('error', reject);

      // Colors
      const primaryGreen = '#1a5c38';
      const lightGreen = '#f5f9f6';
      const borderGreen = '#d4e8da';
      const orange = '#e65100';
      const darkGray = '#333';
      const lightGray = '#666';

      let yPos = 50;

      // ===== HEADER =====
      const logoBuffer = getLogoBuffer();
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, 50, yPos, { height: 50 });
        } catch (e) {
          // If logo fails, show text
          doc.fontSize(24).fillColor(primaryGreen).font('Helvetica-Bold').text('VEGAVRUDDHI', 50, yPos);
        }
      } else {
        doc.fontSize(24).fillColor(primaryGreen).font('Helvetica-Bold').text('VEGAVRUDDHI', 50, yPos);
      }

      // Header right side
      doc.fontSize(18).fillColor(primaryGreen).font('Helvetica-Bold').text('Salary Slip', 400, yPos, { align: 'right' });
      doc.fontSize(10).fillColor(lightGray).font('Helvetica').text(`${slipData.month} ${slipData.year}`, 400, yPos + 22, { align: 'right' });
      doc.fontSize(9).fillColor(lightGray).text(`Generated: ${generatedDate}`, 400, yPos + 36, { align: 'right' });

      yPos += 65;

      // Header border
      doc.strokeColor(primaryGreen).lineWidth(3).moveTo(50, yPos).lineTo(545, yPos).stroke();
      yPos += 20;

      // ===== EMPLOYEE INFO BOX =====
      const boxTop = yPos;
      const boxHeight = 90;
      doc.rect(50, boxTop, 495, boxHeight).fillAndStroke(lightGreen, borderGreen);

      // Info grid (2 columns)
      const col1X = 65;
      const col2X = 310;
      let infoY = boxTop + 15;
      const lineHeight = 18;

      const infoItems = [
        ['Employee Name:', slipData.employeeName, 'Employee ID:', slipData.employeeId || 'N/A'],
        ['Department:', 'Sales', 'Designation:', slipData.role || 'FSE'],
        ['Month:', `${slipData.month} ${slipData.year}`, 'Working Days:', `${calc.workingDays}`],
        ['Base Points:', `${slipData.pointsEarned || 0} pts`, 'Slab Bonus:', (slipData.slabPoints || 0) > 0 ? `+${slipData.slabPoints} pts` : '—'],
      ];

      infoItems.forEach(([label1, val1, label2, val2]) => {
        // Column 1
        doc.fontSize(9).fillColor(primaryGreen).font('Helvetica-Bold').text(label1, col1X, infoY, { width: 100, continued: false });
        doc.fontSize(9).fillColor(darkGray).font('Helvetica').text(val1, col1X + 105, infoY, { width: 130 });
        
        // Column 2
        doc.fontSize(9).fillColor(primaryGreen).font('Helvetica-Bold').text(label2, col2X, infoY, { width: 100, continued: false });
        doc.fontSize(9).fillColor(darkGray).font('Helvetica').text(val2, col2X + 105, infoY, { width: 130 });
        
        infoY += lineHeight;
      });

      // Total points (full width)
      infoY += 3;
      doc.fontSize(9).fillColor(primaryGreen).font('Helvetica-Bold').text('Total Points:', col1X, infoY);
      doc.fontSize(9).fillColor(primaryGreen).font('Helvetica-Bold')
        .text(`${slipData.totalPoints || slipData.pointsEarned || 0} pts × ₹${slipData.pointValue || 250} = ${fmt(calc.pointsSalary)}`, 
              col1X + 105, infoY);

      yPos = boxTop + boxHeight + 20;

      // ===== EARNINGS SECTION =====
      doc.fontSize(12).fillColor(primaryGreen).font('Helvetica-Bold').text('Earnings', 50, yPos);
      yPos += 5;
      doc.strokeColor(primaryGreen).lineWidth(2).moveTo(50, yPos).lineTo(545, yPos).stroke();
      yPos += 15;

      // Earnings table header
      const tableLeft = 50;
      const tableWidth = 495;
      const tableRight = tableLeft + tableWidth;
      
      // Column positions for admin view
      const componentX = tableLeft + 10;
      const percentX = isAdmin ? 360 : 0;
      const amountRightX = tableRight - 10; // Right edge minus padding
      
      console.log('🔧 Using NEW PDF layout with absolute positioning');
      
      doc.rect(tableLeft, yPos, tableWidth, 22).fill(primaryGreen);
      doc.fontSize(10).fillColor('white').font('Helvetica-Bold')
        .text('Component', componentX, yPos + 7);
      
      if (isAdmin) {
        doc.text('%', percentX, yPos + 7, { width: 80, align: 'center' });
      }
      
      doc.text('Amount (₹)', amountRightX - 100, yPos + 7, { width: 100, align: 'right' });
      yPos += 22;

      // Earnings rows
      const earningsRows = [
        { label: 'Basic', pct: calc.pctBasic, amt: calc.basic },
        { label: 'HRA', pct: calc.pctHRA, amt: calc.hra },
        { label: 'Conveyance / Fuel', pct: calc.pctConv, amt: calc.conveyance },
        { label: 'Special Allowance', pct: calc.pctSpec, amt: calc.specialAllowance },
      ];

      let rowBg = false;
      earningsRows.forEach(row => {
        if (rowBg) {
          doc.rect(tableLeft, yPos, tableWidth, 20).fill('#fafafa');
        }
        rowBg = !rowBg;

        doc.fontSize(9).fillColor(darkGray).font('Helvetica')
          .text(row.label, componentX, yPos + 6);
        
        if (isAdmin) {
          doc.text(`${row.pct}%`, percentX, yPos + 6, { width: 80, align: 'center' });
        }
        
        doc.font('Helvetica-Bold').text(fmt(row.amt), amountRightX - 100, yPos + 6, { width: 100, align: 'right' });
        yPos += 20;
      });

      // Incentive row (if applicable)
      if (calc.hasIncentive) {
        if (rowBg) {
          doc.rect(tableLeft, yPos, tableWidth, 20).fill('#fafafa');
        }
        doc.fontSize(9).fillColor(orange).font('Helvetica-Bold')
          .text(`Incentive (${fmt(calc.pointsSalary)} − ${fmt(calc.FIXED_GROSS)})`, componentX, yPos + 6);
        
        if (isAdmin) {
          doc.fillColor(orange).text('Variable', percentX, yPos + 6, { width: 80, align: 'center' });
        }
        
        doc.fillColor(orange).text(fmt(calc.incentive), amountRightX - 100, yPos + 6, { width: 100, align: 'right' });
        yPos += 20;
      }

      // Gross salary row
      doc.rect(tableLeft, yPos, tableWidth, 24).fill('#f0f7f2');
      doc.strokeColor(primaryGreen).lineWidth(2).moveTo(tableLeft, yPos).lineTo(tableLeft + tableWidth, yPos).stroke();
      doc.fontSize(11).fillColor(darkGray).font('Helvetica-Bold')
        .text('Gross Salary', componentX, yPos + 7);
      doc.text(fmt(calc.grossSalary), amountRightX - 100, yPos + 7, { width: 100, align: 'right' });
      yPos += 30;

      // ===== DEDUCTIONS SECTION =====
      doc.fontSize(12).fillColor(primaryGreen).font('Helvetica-Bold').text('Deductions', 50, yPos);
      yPos += 5;
      doc.strokeColor(primaryGreen).lineWidth(2).moveTo(50, yPos).lineTo(545, yPos).stroke();
      yPos += 15;

      // Deductions table header
      const dedComponentX = componentX;
      const dedAmountRightX = tableRight - 10;

      doc.rect(tableLeft, yPos, tableWidth, 22).fill(primaryGreen);
      doc.fontSize(10).fillColor('white').font('Helvetica-Bold')
        .text('Component', dedComponentX, yPos + 7);
      doc.text('Amount (₹)', dedAmountRightX - 100, yPos + 7, { width: 100, align: 'right' });
      yPos += 22;

      // Deduction rows
      const deductionItems = [
        { label: 'Employee PF', val: calc.employeePF },
        { label: 'Professional Tax', val: calc.professionalTax },
        { label: 'ESIC (if applicable)', val: calc.esic },
        { label: 'TDS (as applicable)', val: calc.tds },
      ];

      rowBg = false;
      deductionItems.forEach(item => {
        if (rowBg) {
          doc.rect(tableLeft, yPos, tableWidth, 20).fill('#fafafa');
        }
        rowBg = !rowBg;

        doc.fontSize(9).fillColor(darkGray).font('Helvetica')
          .text(item.label, dedComponentX, yPos + 6);
        
        if (item.val > 0) {
          doc.font('Helvetica-Bold').fillColor(darkGray).text(fmt(item.val), dedAmountRightX - 100, yPos + 6, { width: 100, align: 'right' });
        } else {
          doc.font('Helvetica-Oblique').fillColor('#bbb').text('—', dedAmountRightX - 100, yPos + 6, { width: 100, align: 'right' });
        }
        yPos += 20;
      });

      // Total deductions row
      doc.rect(tableLeft, yPos, tableWidth, 24).fill('#f0f7f2');
      doc.strokeColor(primaryGreen).lineWidth(2).moveTo(tableLeft, yPos).lineTo(tableLeft + tableWidth, yPos).stroke();
      doc.fontSize(11).fillColor(darkGray).font('Helvetica-Bold')
        .text('Total Deductions', dedComponentX, yPos + 7);
      doc.text(fmt(calc.totalDeductions), dedAmountRightX - 100, yPos + 7, { width: 100, align: 'right' });
      yPos += 30;

      // ===== NET SALARY BOX =====
      doc.rect(50, yPos, 495, 45).fillAndStroke(primaryGreen, primaryGreen);
      doc.fontSize(14).fillColor('white').font('Helvetica-Bold')
        .text('Net Salary (Take Home)', 65, yPos + 15);
      doc.fontSize(20).fillColor('white').font('Helvetica-Bold')
        .text(fmt(calc.netSalary), 400, yPos + 13, { align: 'right' });
      yPos += 55;

      // ===== REMARKS (if any) =====
      if (slipData.remarks) {
        doc.rect(50, yPos, 495, 30).fillAndStroke('#fff8e1', '#ffc107');
        doc.strokeColor('#ffc107').lineWidth(4).moveTo(50, yPos).lineTo(50, yPos + 30).stroke();
        doc.fontSize(9).fillColor('#555').font('Helvetica-Bold')
          .text('Remarks: ', 60, yPos + 10, { continued: true })
          .font('Helvetica').text(slipData.remarks);
        yPos += 40;
      }

      // ===== FOOTER =====
      doc.fontSize(8).fillColor('#aaa').font('Helvetica')
        .text(`This is a computer-generated document. No signature required.  |  © ${new Date().getFullYear()} Vegavruddhi Pvt. Ltd.`, 
              50, 780, { align: 'center', width: 495 });

      // Finalize PDF
      doc.end();

    } catch (error) {
      console.error('❌ PDF generation error:', error.message);
      reject(new Error(`PDF generation failed: ${error.message}`));
    }
  });
}

module.exports = { 
  generateSalarySlipPDF, 
  generatePDFBuffer: generateSalarySlipPDF, 
  calculateSalaryBreakdown 
};
