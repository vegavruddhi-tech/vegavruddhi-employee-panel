const mongoose = require('mongoose');

const tlNotificationSchema = new mongoose.Schema({
  tlId:         { type: mongoose.Schema.Types.ObjectId, ref: 'TeamLead', required: true },
  tlName:       { type: String, required: true },
  type:         { type: String, default: 'fse_points_update' },
  fseName:      { type: String, required: true },
  adjustment:   { type: Number, required: true },
  beforeTotal:  { type: Number },
  newTotal:     { type: Number },
  reason:       { type: String, default: '' },
  acknowledged: { type: Boolean, default: false },
  createdAt:    { type: Date, default: Date.now },
}, { collection: 'TLNotifications' });

module.exports = mongoose.model('TLNotification', tlNotificationSchema);
