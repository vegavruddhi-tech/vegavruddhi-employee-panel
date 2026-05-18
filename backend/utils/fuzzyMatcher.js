/**
 * Fuzzy Name Matcher
 * 
 * Uses Levenshtein distance to match employee names with typos/variations
 * Threshold: 80% similarity = match
 */

const fuzz = require('fuzzball');

/**
 * Find best matching employee from database
 * @param {string} sheetName - Name from Excel sheet
 * @param {Array} employees - Array of employee objects from database
 * @param {number} threshold - Minimum similarity score (0-100), default 80
 * @returns {Object|null} - { employee, score } or null if no match
 */
function findBestMatch(sheetName, employees, threshold = 80) {
  if (!sheetName || !employees || employees.length === 0) {
    return null;
  }

  const normalizedSheetName = sheetName.trim().toLowerCase();
  
  let bestMatch = null;
  let bestScore = 0;

  for (const emp of employees) {
    const empName = (emp.newJoinerName || '').trim().toLowerCase();
    
    if (!empName) continue;

    // Calculate similarity score (0-100)
    const score = fuzz.ratio(normalizedSheetName, empName);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = emp;
    }
  }

  // Return match only if above threshold
  if (bestScore >= threshold) {
    return {
      employee: bestMatch,
      score: bestScore,
      matched: true
    };
  }

  return {
    employee: null,
    score: bestScore,
    matched: false,
    originalName: sheetName
  };
}

/**
 * Batch match multiple names
 * @param {Array} sheetNames - Array of names from Excel
 * @param {Array} employees - Array of employee objects from database
 * @param {number} threshold - Minimum similarity score
 * @returns {Array} - Array of match results
 */
function batchMatch(sheetNames, employees, threshold = 80) {
  return sheetNames.map(name => ({
    sheetName: name,
    ...findBestMatch(name, employees, threshold)
  }));
}

module.exports = {
  findBestMatch,
  batchMatch
};
