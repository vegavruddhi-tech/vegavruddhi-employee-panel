/**
 * Test script to compare Puppeteer vs PDFKit PDF generation
 * 
 * Usage: node backend/utils/testPDFComparison.js
 */

const fs = require('fs');
const path = require('path');

// Import both generators
const puppeteerGen = require('./pdfGenerator');
const pdfkitGen = require('./pdfGeneratorPDFKit');

// Sample salary slip data
const sampleSlipData = {
  employeeName: 'John Doe',
  employeeId: 'EMP001',
  role: 'FSE',
  month: 'January',
  year: 2026,
  pointsEarned: 120,
  slabPoints: 10,
  totalPoints: 130,
  pointValue: 250,
  pctBasic: 50,
  pctHRA: 25,
  pctConv: 5,
  pctSpec: 20,
  deductionPF: 1800,
  deductionPT: 200,
  deductionESIC: 0,
  deductionTDS: 500,
  remarks: 'Great performance this month!',
  generatedAt: new Date()
};

async function runComparison() {
  console.log('🔬 Starting PDF Generation Comparison...\n');
  
  const outputDir = path.join(__dirname, '../test-pdfs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // Test 1: Puppeteer
    console.log('📊 Test 1: Puppeteer PDF Generation');
    const startPuppeteer = Date.now();
    const puppeteerBuffer = await puppeteerGen.generateSalarySlipPDF(sampleSlipData, true);
    const timePuppeteer = Date.now() - startPuppeteer;
    
    const puppeteerPath = path.join(outputDir, 'salary-slip-puppeteer.pdf');
    fs.writeFileSync(puppeteerPath, puppeteerBuffer);
    
    console.log(`✅ Puppeteer PDF generated`);
    console.log(`   Time: ${timePuppeteer}ms`);
    console.log(`   Size: ${(puppeteerBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   Path: ${puppeteerPath}\n`);

    // Test 2: PDFKit
    console.log('📊 Test 2: PDFKit PDF Generation');
    const startPDFKit = Date.now();
    const pdfkitBuffer = await pdfkitGen.generateSalarySlipPDF(sampleSlipData, true);
    const timePDFKit = Date.now() - startPDFKit;
    
    const pdfkitPath = path.join(outputDir, 'salary-slip-pdfkit.pdf');
    fs.writeFileSync(pdfkitPath, pdfkitBuffer);
    
    console.log(`✅ PDFKit PDF generated`);
    console.log(`   Time: ${timePDFKit}ms`);
    console.log(`   Size: ${(pdfkitBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   Path: ${pdfkitPath}\n`);

    // Comparison
    console.log('📈 Comparison Results:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Speed Improvement: ${((timePuppeteer - timePDFKit) / timePuppeteer * 100).toFixed(1)}% faster`);
    console.log(`Size Difference: ${((puppeteerBuffer.length - pdfkitBuffer.length) / 1024).toFixed(2)} KB smaller`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Test 3: Without incentive (salary <= 25000)
    console.log('📊 Test 3: Low Salary (No Incentive) - PDFKit');
    const lowSalaryData = { ...sampleSlipData, totalPoints: 80, pointsEarned: 80 }; // 80 * 250 = 20,000
    const lowSalaryBuffer = await pdfkitGen.generateSalarySlipPDF(lowSalaryData, false);
    const lowSalaryPath = path.join(outputDir, 'salary-slip-low-salary.pdf');
    fs.writeFileSync(lowSalaryPath, lowSalaryBuffer);
    console.log(`✅ Low salary PDF generated: ${lowSalaryPath}\n`);

    // Test 4: High incentive
    console.log('📊 Test 4: High Incentive - PDFKit');
    const highIncentiveData = { ...sampleSlipData, totalPoints: 200, pointsEarned: 200 }; // 200 * 250 = 50,000
    const highIncentiveBuffer = await pdfkitGen.generateSalarySlipPDF(highIncentiveData, true);
    const highIncentivePath = path.join(outputDir, 'salary-slip-high-incentive.pdf');
    fs.writeFileSync(highIncentivePath, highIncentiveBuffer);
    console.log(`✅ High incentive PDF generated: ${highIncentivePath}\n`);

    console.log('✨ All tests completed successfully!');
    console.log(`📁 Check the PDFs in: ${outputDir}`);
    console.log('\n💡 Next steps:');
    console.log('   1. Open and compare the PDFs visually');
    console.log('   2. If satisfied, follow the migration guide in PDF_MIGRATION_GUIDE.md');
    console.log('   3. Remove Puppeteer to save ~300-500 MB\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the comparison
runComparison().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
