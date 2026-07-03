const express = require('express');
const { verifyMerchant } = require('../utils/verifyMerchant');

module.exports = (connectionManager, connectDB) => {
  const router = express.Router();

  // Middleware to ensure DB connection and attach to req
  router.use(async (req, res, next) => {
    try {
      const mongoose = await connectDB();
      if (!mongoose) {
        return res.status(503).json({ error: 'Database connection unavailable' });
      }
      req.db = mongoose.connection.db;
      next();
    } catch (error) {
      console.error('DB middleware error:', error);
      res.status(500).json({ error: 'Database connection failed' });
    }
  });

  /**
   * GET /api/tide/priority-pass-batch
   * Lightweight endpoint to fetch Priority Pass status for multiple phones in a specific collection
   * Query params: phones (comma-separated), collection (e.g., "tl_connect_may")
   */
  router.get('/priority-pass-batch', async (req, res) => {
    try {
      const { phones, collection } = req.query;

      if (!phones || !collection) {
        return res.status(400).json({ error: 'phones and collection parameters are required' });
      }

      const db = req.db;
      const phoneArray = phones.split(',').filter(p => p.trim());
      
      // Generate all phone variants for each phone
      const allPhoneVariants = [];
      phoneArray.forEach(phone => {
        const cleanPhone = String(phone).replace(/\D/g, '');
        const variants = [phone, cleanPhone, Number(cleanPhone)];
        
        if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
          variants.push('91' + cleanPhone);
          variants.push(Number('91' + cleanPhone));
        }
        
        if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
          const without91 = cleanPhone.slice(2);
          variants.push(without91);
          variants.push(Number(without91));
        }
        
        allPhoneVariants.push(...variants);
      });
      
      // Query the collection
      const coll = db.collection(collection);
      const records = await coll.find({ 
        phone: { $in: allPhoneVariants }
      }).toArray();
      
      // Build response map: phone -> {priority_pass_pro, location, merchant_name}
      const result = {};
      records.forEach(record => {
        const phone = String(record.phone || '').replace(/\D/g, '');
        const normalizedPhone = phone.startsWith('91') && phone.length === 12 
          ? phone.slice(2) 
          : phone;
        
        // Store with normalized phone (10 digits)
        result[normalizedPhone] = {
          priority_pass_pro: record.priority_pass_pro || null,
          location: record.location || null,
          merchant_name: record.merchant_name || record.customer_name || null
        };
        
        // Also store with original phone format for lookup
        if (record.phone) {
          result[String(record.phone)] = result[normalizedPhone];
        }
      });
      
      res.json(result);

    } catch (error) {
      console.error('Priority Pass batch error:', error);
      res.status(500).json({ error: 'Failed to fetch Priority Pass batch data' });
    }
  });

  /**
   * GET /api/tide/merchant-timeline
   * Fetches verification status and Priority Pass Pro data for a merchant across all 12 months
   * Uses VerificationCache for fast, consistent results
   * Query params: phone (required), name (optional)
   */
  router.get('/merchant-timeline', async (req, res) => {
    try {
      const { phone, name } = req.query;

      if (!phone) {
        return res.status(400).json({ error: 'Phone number is required' });
      }

      const db = req.db;
      const VerificationRule = require('../models/VerificationRule');
      
      const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      
      const currentYear = new Date().getFullYear();
      const timeline = [];

      // Generate phone variants
      const cleanPhone = String(phone).replace(/\D/g, '');
      const phoneVariants = [phone, cleanPhone, Number(cleanPhone)];
      
      if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
        phoneVariants.push('91' + cleanPhone);
        phoneVariants.push(Number('91' + cleanPhone));
      }
      
      if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
        const without91 = cleanPhone.slice(2);
        phoneVariants.push(without91);
        phoneVariants.push(Number(without91));
      }

      // Pre-fetch rules once for all months
      const activeRules = await VerificationRule.find({ active: true });

      // Query all months concurrently
      const timelineResults = await Promise.all(months.map(async (month) => {
        const monthKey = month.toLowerCase();
        const collectionName = `tl_connect_${monthKey}`;
        const monthYear = `${month} ${currentYear}`;
        
        try {
          const collection = db.collection(collectionName);
          
          // Find record in this month's collection
          let record = null;
          for (const variant of phoneVariants) {
            record = await collection.findOne({ phone: variant });
            if (record) break;
          }

          if (record) {
            let verificationStatus = 'Not Verified';
            let verificationDetails = null;
            
            try {
              const merchantName = name || record.merchant_name || record.customer_name || '';
              const verification = await verifyMerchant(
                db,
                phone,
                merchantName,
                VerificationRule,
                'tide',
                monthYear,
                activeRules
              );
              verificationStatus = verification.status || 'Not Verified';
              verificationDetails = verification;
            } catch (verifyErr) {
              console.error(`[${month}] Verification error:`, verifyErr.message);
            }
            
            return {
              month: month,
              monthKey: monthKey,
              status: verificationStatus,
              priorityPass: record.priority_pass_pro || null,
              hasData: true,
              verification: verificationDetails,
              merchantName: record.merchant_name || record.customer_name || null,
              location: record.location || null,
              lastUpdated: record._synced_at || null
            };
          } else {
            return {
              month: month,
              monthKey: monthKey,
              status: 'Not Found',
              priorityPass: null,
              hasData: false,
              verification: null,
              merchantName: null,
              location: null,
              lastUpdated: null
            };
          }
        } catch (monthErr) {
          console.error(`[${month}] Error:`, monthErr.message);
          return {
            month: month,
            monthKey: monthKey,
            status: 'Not Found',
            priorityPass: null,
            hasData: false,
            verification: null,
            merchantName: null,
            location: null,
            lastUpdated: null
          };
        }
      }));

      res.json({
        phone,
        timeline: timelineResults,
        currentMonth: new Date().toLocaleString('en-US', { month: 'long' }).toLowerCase()
      });

    } catch (error) {
      console.error('Timeline API error:', error);
      res.status(500).json({ error: 'Failed to fetch merchant timeline' });
    }
  });

  /**
   * GET /api/tide/priority-pass-tracking
   * Tracks Priority Pass status for merchants verified in a specific month
   * Shows their Priority Pass status across all future months
   * Query params: month (required, e.g., "April 2026")
   */
  router.get('/priority-pass-tracking', async (req, res) => {
    try {
      const { month } = req.query;

      if (!month) {
        return res.status(400).json({ error: 'Month parameter is required (e.g., "April 2026")' });
      }

      const db = req.db;
      const VerificationRule = require('../models/VerificationRule');
      
      // Parse the month
      const [monthName, yearStr] = month.split(' ');
      const year = parseInt(yearStr) || new Date().getFullYear();
      const monthIndex = new Date(`${monthName} 1, ${year}`).getMonth();
      
      const allMonths = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      
      // Get the verification month collection
      const verificationMonthKey = monthName.toLowerCase();
      const verificationCollection = `tl_connect_${verificationMonthKey}`;
      
      // Get all future months (including current)
      const futureMonths = allMonths.slice(monthIndex);
      
      // Find all Tide merchants verified in the specified month
      const collection = db.collection(verificationCollection);
      const allRecords = await collection.find({}).toArray();
      
      const merchantsData = [];
      
      for (const record of allRecords) {
        const phone = record.phone || record.Mobile_No_ || record.mobile_no_;
        if (!phone) continue;
        
        const merchantName = record.merchant_name || record.customer_name || record.Customer || '';
        
        // Verify this merchant in the verification month
        try {
          const verification = await verifyMerchant(
            db,
            phone,
            merchantName,
            VerificationRule,
            'tide',
            `${monthName} ${year}`,
            null
          );
          
          // Only include if fully verified in the verification month
          if (verification.status !== 'Fully Verified') continue;
          
          // Now check Priority Pass status across all future months
          const priorityPassStatus = {};
          let hasActivePriorityPass = false;
          
          for (const futureMonth of futureMonths) {
            const futureMonthKey = futureMonth.toLowerCase();
            const futureCollectionName = `tl_connect_${futureMonthKey}`;
            
            try {
              const futureCollection = db.collection(futureCollectionName);
              
              // Generate phone variants
              const cleanPhone = String(phone).replace(/\D/g, '');
              const phoneVariants = [phone, cleanPhone, Number(cleanPhone)];
              
              if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
                phoneVariants.push('91' + cleanPhone);
                phoneVariants.push(Number('91' + cleanPhone));
              }
              
              if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
                const without91 = cleanPhone.slice(2);
                phoneVariants.push(without91);
                phoneVariants.push(Number(without91));
              }
              
              // Find record in future month
              let futureRecord = null;
              for (const variant of phoneVariants) {
                futureRecord = await futureCollection.findOne({ phone: variant });
                if (futureRecord) break;
              }
              
              if (futureRecord && futureRecord.priority_pass_pro === 'Active') {
                priorityPassStatus[futureMonth] = 'Active';
                hasActivePriorityPass = true;
              } else if (futureRecord) {
                priorityPassStatus[futureMonth] = futureRecord.priority_pass_pro || 'Not Active';
              } else {
                priorityPassStatus[futureMonth] = 'No Data';
              }
            } catch (err) {
              priorityPassStatus[futureMonth] = 'Error';
            }
          }
          
          // Only include merchants who have at least one active Priority Pass in future months
          if (hasActivePriorityPass) {
            merchantsData.push({
              phone: String(phone),
              merchantName,
              location: record.location || null,
              verifiedMonth: monthName,
              priorityPassStatus,
              verificationDetails: {
                status: verification.status,
                passed: verification.passed,
                total: verification.total
              }
            });
          }
        } catch (verifyErr) {
          console.error(`Error verifying merchant ${phone}:`, verifyErr.message);
          continue;
        }
      }
      
      res.json({
        verificationMonth: month,
        futureMonths,
        merchants: merchantsData,
        totalCount: merchantsData.length
      });

    } catch (error) {
      console.error('Priority Pass tracking error:', error);
      res.status(500).json({ error: 'Failed to fetch Priority Pass tracking data' });
    }
  });

  return router;
};
