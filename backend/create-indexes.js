/**
 * Create database indexes for faster phone number lookups
 * Run this once: node create-indexes.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const PHONE_COLS = [
  'Mobile_No_', 'Mobile_Number', 'Phone_Number', 'Number',
  'phone', 'Phone', 'Mobile', 'mobile', 'Contact',
  'Customer_Number', 'Merchant_Number', 'Mobile_No',
  'mobile_no_', 'mobile_number', 'phone_number', 'number',
  'contact', 'customer_number', 'merchant_number', 'mobile_no'
];

async function createIndexes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    
    console.log(`Found ${collections.length} collections`);

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      
      // Skip system collections
      if (collectionName.startsWith('system.')) continue;
      
      const collection = db.collection(collectionName);
      
      // Create indexes for all phone number fields
      for (const phoneCol of PHONE_COLS) {
        try {
          await collection.createIndex({ [phoneCol]: 1 }, { 
            background: true, 
            sparse: true,
            name: `idx_${phoneCol}_phone`
          });
          console.log(`✅ Created index on ${collectionName}.${phoneCol}`);
        } catch (err) {
          // Index might already exist, ignore error
          if (!err.message.includes('already exists')) {
            console.log(`⚠️  Could not create index on ${collectionName}.${phoneCol}: ${err.message}`);
          }
        }
      }
    }

    console.log('✅ All indexes created successfully!');
    process.exit(0);

  } catch (err) {
    console.error('❌ Error creating indexes:', err);
    process.exit(1);
  }
}

createIndexes();