const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Logo path
let LOGO_PATH = null;

function findLogo() {
  if (LOGO_PATH) return LOGO_PATH;
  
  const logoPaths = [
    path.join(__dirname, '../../../vegavruddhi-admin-panel/fse-dashboard/public/logo-full.png'),
    path.join(__dirname, '../../employee-app/public/logo-full.png'),
    path.join(__dirname, '../../../tl-dashboard/public/logo-full.png'),
    path.join(__dirname, '../../../vegavruddhi-admin-panel/fse-dashboard/public/logo192.png'),
    path.join(__dirname, '../../employee-app/public/logo192.png'),
  ];
  
  for (const logoPath of logoPaths) {
    if (fs.existsSync(logoPath)) {
      LOGO_PATH = logoPath;
      console.log('✅ Logo found:', logoPath);
      return LOGO_PATH;
    }
  }
  
  console.warn('⚠️ Logo not found in any expected location');
  return null;
}

function getWorkingDaysInMonth(month, year) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const monthIndex = months.indexOf(month);
  if (monthIndex === -1) return 30;
  return new Date(year, monthIndex + 1, 0).getDate();
}

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

async function generateSalarySlipPDF(slipData, isAdmin = false) {
  return new Promise((resolve, reject) => {
    try {
      if (!slipData || !slipData.employeeName || !slipData.month || !slipData.year) {
        throw new Error('Invalid slip data');
      }
      
      console.log(`📄 Generating PDF for ${slipData.employeeName} (${slipData.month} ${slipData.year})...`);

      const calc = calculateSalaryBreakdown(slipData);
      // Rupee formatting - using Rs. prefix since rupee symbol has encoding issues in PDFKit
      const fmt = (n) => {
        const amount = Number(n || 0).toLocaleString('en-IN', { 
          minimumFractionDigits: 0, 
          maximumFractionDigits: 0 
        });
        return 'Rs.' + amount;  // Using Rs. instead of ₹ symbol
      };
      
      const generatedDate = new Date(slipData.generatedAt || Date.now()).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

      // Create PDF document
      const doc = new PDFDocument({ 
        size: 'A4', 
        margins: { top: 50, bottom: 50, left: 40, right: 40 }
      });
      
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`✅ PDF generated, size: ${buffer.length} bytes`);
        resolve(buffer);
      });
      doc.on('error', reject);

      // Colors
      const GREEN_PRIMARY = '#1a5c38';
      const GREEN_LIGHT = '#e8f5e9';
      const GRAY_LIGHT = '#f5f5f5';
      const GRAY_BORDER = '#e0e0e0';
      const TEXT_PRIMARY = '#333333';
      const TEXT_SECONDARY = '#666666';

      // ==================== HEADER ====================
      let y = 40;  // Moved up from 50
      
      // Add logo
      const logoPath = findLogo();
      if (logoPath) {
        try {
          // Logo on the left side - positioned higher
          doc.image(logoPath, 40, y, { width: 120, height: 50, fit: [120, 50] });
          console.log('✅ Logo added to PDF');
        } catch (e) {
          console.warn('⚠️ Logo load failed:', e.message);
          // Fallback to text if logo fails
          doc.fontSize(18).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
             .text('VEGAVRUDDHI', 40, y + 10);
        }
      } else {
        // Fallback: Company name text if no logo found
        doc.fontSize(18).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
           .text('VEGAVRUDDHI', 40, y + 10);
      }
      
      // Salary Slip title (right side)
      doc.fontSize(20).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
         .text('Salary Slip', 380, y + 5, { width: 175, align: 'right' });
      
      doc.fontSize(11).fillColor(TEXT_SECONDARY).font('Helvetica')
         .text(slipData.month + ' ' + slipData.year, 380, y + 32, { width: 175, align: 'right' });
      
      doc.fontSize(9).fillColor(TEXT_SECONDARY)
         .text('Generated: ' + generatedDate, 380, y + 48, { width: 175, align: 'right' });
      
      // Green line separator
      y = 105;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(2).strokeColor(GREEN_PRIMARY).stroke();
      
      // ==================== EMPLOYEE INFO BOX ====================
      y = 120;
      const hasSlabBonus = (slipData.slabPoints || 0) > 0;
      const boxHeight = hasSlabBonus ? 88 : 74;  // Smaller box if no slab bonus
      
      // Background box with rounded corners
      doc.roundedRect(40, y, 515, boxHeight, 3)
         .fillAndStroke(GREEN_LIGHT, GRAY_BORDER);
      
      // Employee info - 2 columns layout
      const col1X = 55;   // Label column 1
      const col2X = 170;  // Value column 1 (moved from 210 - closer to label)
      const col3X = 330;  // Label column 2
      const col4X = 440;  // Value column 2 (moved from 470 - closer to label)
      let infoY = y + 12;
      const lineHeight = 14;
      
      // Row 1: Employee Name & Employee ID
      doc.fontSize(10).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
         .text('Employee Name:', col1X, infoY);
      doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Helvetica')
         .text(slipData.employeeName, col2X, infoY);
      
      doc.fontSize(10).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
         .text('Employee ID:', col3X, infoY);
      doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Helvetica')
         .text(slipData.employeeId || 'N/A', col4X, infoY);
      
      infoY += lineHeight;
      
      // Row 2: Department & Designation
      doc.fontSize(10).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
         .text('Department:', col1X, infoY);
      doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Helvetica')
         .text('Sales', col2X, infoY);
      
      doc.fontSize(10).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
         .text('Designation:', col3X, infoY);
      doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Helvetica')
         .text(slipData.role || 'FSE', col4X, infoY);
      
      infoY += lineHeight;
      
      // Row 3: Month & Working Days
      doc.fontSize(10).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
         .text('Month:', col1X, infoY);
      doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Helvetica')
         .text(`${slipData.month} ${slipData.year}`, col2X, infoY);
      
      doc.fontSize(10).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
         .text('Working Days:', col3X, infoY);
      doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Helvetica')
         .text(String(calc.workingDays), col4X, infoY);
      
      infoY += lineHeight;
      
      // Row 4: Base Points & Slab Bonus (only show if slab bonus exists)
      
      if (hasSlabBonus) {
        // Show both Base Points and Slab Bonus
        doc.fontSize(10).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
           .text('Base Points:', col1X, infoY);
        doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Helvetica')
           .text(`${slipData.pointsEarned || 0} pts`, col2X, infoY);
        
        doc.fontSize(10).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
           .text('Slab Bonus:', col3X, infoY);
        doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Helvetica')
           .text(`+${slipData.slabPoints} pts`, col4X, infoY);
        
        infoY += lineHeight;
      }
      
      // Row 5: Total Points (full width, highlighted)
      doc.fontSize(10).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
         .text('Total Points:', col1X, infoY);
      doc.fontSize(10).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
         .text(`${slipData.totalPoints || slipData.pointsEarned || 0} pts × Rs.${slipData.pointValue || 250} = ${fmt(calc.pointsSalary)}`, 
               col2X, infoY, { width: 350 });
      
      // ==================== EARNINGS SECTION ====================
      y = hasSlabBonus ? 228 : 214;  // Adjust based on whether slab bonus was shown
      
      doc.fontSize(12).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
         .text('Earnings', 40, y);
      
      doc.moveTo(40, y + 18).lineTo(555, y + 18)
         .lineWidth(1.5).strokeColor(GREEN_PRIMARY).stroke();
      
      y += 28;
      
      // Earnings table
      const tableX = 40;
      const tableWidth = 515;
      const rowHeight = 25;
      
      // Table header
      doc.rect(tableX, y, tableWidth, rowHeight)
         .fillAndStroke(GREEN_PRIMARY, GREEN_PRIMARY);
      
      doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold');
      
      if (isAdmin) {
        doc.text('Component', tableX + 10, y + 7, { width: 240 });
        doc.text('%', tableX + 260, y + 7, { width: 80, align: 'center' });
        doc.text('Amount (Rs.)', tableX + 350, y + 7, { width: 155, align: 'right' });
      } else {
        doc.text('Component', tableX + 10, y + 7, { width: 340 });
        doc.text('Amount (Rs.)', tableX + 360, y + 7, { width: 145, align: 'right' });
      }
      
      y += rowHeight;
      
      // Earnings rows
      const earningsData = [
        ['Basic', '50%', calc.basic],
        ['HRA', '25%', calc.hra],
        ['Conveyance / Fuel', '5%', calc.conveyance],
        ['Special Allowance', '20%', calc.specialAllowance]
      ];
      
      if (calc.hasIncentive) {
        earningsData.push([
          `Incentive (${fmt(calc.pointsSalary)} − ${fmt(calc.FIXED_GROSS)})`,
          'Variable',
          calc.incentive
        ]);
      }
      
      earningsData.forEach((row, index) => {
        const bgColor = index % 2 === 0 ? '#ffffff' : GRAY_LIGHT;
        doc.rect(tableX, y, tableWidth, rowHeight)
           .fillAndStroke(bgColor, GRAY_BORDER);
        
        doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Helvetica');
        
        if (isAdmin) {
          doc.text(row[0], tableX + 10, y + 7, { width: 240 });
          doc.text(row[1], tableX + 260, y + 7, { width: 80, align: 'center' });
          doc.font('Helvetica-Bold').text(fmt(row[2]), tableX + 350, y + 7, { width: 145, align: 'right' });
        } else {
          doc.text(row[0], tableX + 10, y + 7, { width: 340 });
          doc.font('Helvetica-Bold').text(fmt(row[2]), tableX + 360, y + 7, { width: 145, align: 'right' });
        }
        
        y += rowHeight;
      });
      
      // Gross Salary row
      doc.rect(tableX, y, tableWidth, rowHeight)
         .fillAndStroke(GREEN_LIGHT, GRAY_BORDER);
      
      doc.fontSize(11).fillColor(TEXT_PRIMARY).font('Helvetica-Bold');
      
      if (isAdmin) {
        doc.text('Gross Salary', tableX + 10, y + 7, { width: 240 });
        doc.text(fmt(calc.grossSalary), tableX + 350, y + 7, { width: 145, align: 'right' });
      } else {
        doc.text('Gross Salary', tableX + 10, y + 7, { width: 340 });
        doc.text(fmt(calc.grossSalary), tableX + 360, y + 7, { width: 145, align: 'right' });
      }
      
      y += rowHeight + 20;
      
      // ==================== DEDUCTIONS SECTION ====================
      doc.fontSize(12).fillColor(GREEN_PRIMARY).font('Helvetica-Bold')
         .text('Deductions', 40, y);
      
      doc.moveTo(40, y + 18).lineTo(555, y + 18)
         .lineWidth(1.5).strokeColor(GREEN_PRIMARY).stroke();
      
      y += 28;
      
      // Deductions table header
      doc.rect(tableX, y, tableWidth, rowHeight)
         .fillAndStroke(GREEN_PRIMARY, GREEN_PRIMARY);
      
      doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold');
      doc.text('Component', tableX + 10, y + 7, { width: 340 });
      doc.text('Amount (Rs.)', tableX + 360, y + 7, { width: 145, align: 'right' });
      
      y += rowHeight;
      
      // Deductions rows
      const deductionsData = [
        ['Employee PF', calc.employeePF > 0 ? calc.employeePF : 0],
        ['Professional Tax', calc.professionalTax > 0 ? calc.professionalTax : 0],
        ['ESIC (if applicable)', calc.esic > 0 ? calc.esic : 0],
        ['TDS (as applicable)', calc.tds > 0 ? calc.tds : 0]
      ];
      
      deductionsData.forEach((row, index) => {
        const bgColor = index % 2 === 0 ? '#ffffff' : GRAY_LIGHT;
        doc.rect(tableX, y, tableWidth, rowHeight)
           .fillAndStroke(bgColor, GRAY_BORDER);
        
        doc.fontSize(10).fillColor(TEXT_PRIMARY).font('Helvetica');
        doc.text(row[0], tableX + 10, y + 7, { width: 340 });
        
        const amountText = row[1] > 0 ? fmt(row[1]) : '—';
        doc.font('Helvetica-Bold').text(amountText, tableX + 360, y + 7, { width: 145, align: 'right' });
        
        y += rowHeight;
      });
      
      // Total Deductions row
      doc.rect(tableX, y, tableWidth, rowHeight)
         .fillAndStroke(GREEN_LIGHT, GRAY_BORDER);
      
      doc.fontSize(11).fillColor(TEXT_PRIMARY).font('Helvetica-Bold');
      doc.text('Total Deductions', tableX + 10, y + 7, { width: 340 });
      doc.text(fmt(calc.totalDeductions), tableX + 360, y + 7, { width: 145, align: 'right' });
      
      y += rowHeight + 20;
      
      // ==================== NET SALARY BOX ====================
      const netBoxHeight = 50;
      doc.roundedRect(tableX, y, tableWidth, netBoxHeight, 5)
         .fillAndStroke(GREEN_PRIMARY, GREEN_PRIMARY);
      
      doc.fontSize(15).fillColor('#ffffff').font('Helvetica-Bold')
         .text('Net Salary (Take Home)', tableX + 15, y + 17);
      
      // Shift amount left to fit inside box properly
      doc.fontSize(20).fillColor('#ffffff').font('Helvetica-Bold')
         .text(fmt(calc.netSalary), tableX + 300, y + 15, { width: 200, align: 'right' });
      
      // ==================== FOOTER ====================
      y += netBoxHeight + 30;
      
      doc.fontSize(7).fillColor(TEXT_SECONDARY).font('Helvetica')
         .text(
           `This is a computer-generated document. No signature required.  |  © ${new Date().getFullYear()} Vegavruddhi Pvt. Ltd.`,
           40, y, { width: 515, align: 'center' }
         );
      
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
